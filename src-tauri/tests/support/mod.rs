#![allow(dead_code)]

// The stub upstream is a plain TCP listener: each suite's promise is about
// requests, statuses and call counts, so the tests script what each path answers
// and read back what actually arrived.
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Clone)]
pub struct Seen {
    pub method: String,
    pub path: String,
    pub cookie: String,
    pub body: String,
    pub headers: Vec<(String, String)>,
}

impl Seen {
    pub fn header(&self, name: &str) -> Option<&str> {
        let name = name.to_ascii_lowercase();
        self.headers
            .iter()
            .find(|(header, _)| *header == name)
            .map(|(_, value)| value.as_str())
    }
}

pub enum Act {
    Reply {
        status: u16,
        json: &'static str,
        set_cookie: Option<&'static str>,
    },
    // Answers after a pause, so a second caller has time to arrive while the
    // first is still waiting on the upstream.
    Delayed {
        status: u16,
        json: &'static str,
        delay: Duration,
    },
    Hang,
    Close,
}

pub struct Stub {
    base_url: String,
    log: Arc<Mutex<Vec<Seen>>>,
    stop: Arc<AtomicBool>,
}

impl Stub {
    pub fn start(route: impl Fn(&Seen) -> Act + Send + Sync + 'static) -> Stub {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind the stub");
        let port = listener.local_addr().expect("read the stub address").port();
        let log = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let route = Arc::new(route);

        {
            let (log, stop) = (log.clone(), stop.clone());
            std::thread::spawn(move || {
                for stream in listener.incoming() {
                    if stop.load(Ordering::SeqCst) {
                        break;
                    }
                    let Ok(stream) = stream else { break };
                    let (log, route) = (log.clone(), route.clone());
                    std::thread::spawn(move || handle(stream, log, route));
                }
            });
        }

        Stub {
            base_url: format!("http://127.0.0.1:{port}"),
            log,
            stop,
        }
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn seen(&self) -> Vec<Seen> {
        self.log.lock().expect("read the log").clone()
    }

    pub fn calls(&self, method: &str, path: &str) -> Vec<Seen> {
        self.seen()
            .into_iter()
            .filter(|seen| seen.method == method && seen.path == path)
            .collect()
    }

    pub fn paths(&self) -> Vec<String> {
        self.seen().into_iter().map(|seen| seen.path).collect()
    }

    pub fn wait_for(&self, method: &str, path: &str) -> bool {
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if !self.calls(method, path).is_empty() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        false
    }
}

impl Drop for Stub {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect(self.base_url.trim_start_matches("http://"));
    }
}

fn handle(
    stream: TcpStream,
    log: Arc<Mutex<Vec<Seen>>>,
    route: Arc<dyn Fn(&Seen) -> Act + Send + Sync>,
) {
    let Ok(mut writer) = stream.try_clone() else {
        return;
    };
    let mut reader = BufReader::new(stream);

    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();

    let mut length = 0usize;
    let mut headers = Vec::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 {
            break;
        }
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let name = name.to_ascii_lowercase();
        let value = value.trim().to_string();
        if name == "content-length" {
            length = value.parse().unwrap_or(0);
        }
        headers.push((name, value));
    }

    let mut body = vec![0; length];
    if length > 0 && reader.read_exact(&mut body).is_err() {
        return;
    }

    let cookie = headers
        .iter()
        .find(|(name, _)| name == "cookie")
        .map(|(_, value)| value.clone())
        .unwrap_or_default();
    let seen = Seen {
        method,
        path,
        cookie,
        body: String::from_utf8_lossy(&body).to_string(),
        headers,
    };
    log.lock().expect("record the request").push(seen.clone());

    match route(&seen) {
        Act::Reply {
            status,
            json,
            set_cookie,
        } => write_reply(&mut writer, status, json, set_cookie),
        Act::Delayed {
            status,
            json,
            delay,
        } => {
            std::thread::sleep(delay);
            write_reply(&mut writer, status, json, None);
        }
        // A provider that never answers, and one that drops the socket: the
        // chain must tell those apart from a refusal.
        Act::Hang => std::thread::sleep(Duration::from_secs(2)),
        Act::Close => {}
    }
}

fn write_reply(writer: &mut TcpStream, status: u16, json: &str, set_cookie: Option<&str>) {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        _ => "Unknown",
    };
    let mut head = format!(
        "HTTP/1.1 {status} {reason}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n",
        json.len()
    );
    if let Some(cookie) = set_cookie {
        head.push_str(&format!("set-cookie: {cookie}\r\n"));
    }
    head.push_str("\r\n");
    head.push_str(json);
    let _ = writer.write_all(head.as_bytes());
    let _ = writer.flush();
}
