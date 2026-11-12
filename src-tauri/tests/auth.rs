// The stub upstream is a plain TCP listener: the chain's promise is about
// cookies, statuses and call counts, so the tests script what each path answers
// and read back what actually arrived.
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use velox_lib::auth::{self, Reply, Upstream};

const ADDRESS: &str = "0x1111111111111111111111111111111111111111";
const SIGNATURE: &str = "0xsigned";
const SET_COOKIE: &str = "oa=session-1; Path=/; HttpOnly";
const COOKIE_SENT: &str = "oa=session-1";

#[derive(Clone)]
struct Seen {
    method: String,
    path: String,
    cookie: String,
    body: String,
}

enum Act {
    Reply {
        status: u16,
        json: &'static str,
        set_cookie: Option<&'static str>,
    },
    Hang,
    Close,
}

struct Stub {
    base_url: String,
    log: Arc<Mutex<Vec<Seen>>>,
    stop: Arc<AtomicBool>,
}

impl Stub {
    fn start(route: impl Fn(&Seen) -> Act + Send + Sync + 'static) -> Stub {
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

    fn upstream(&self, timeout_ms: u64) -> Upstream {
        Upstream {
            base_url: self.base_url.clone(),
            timeout: Duration::from_millis(timeout_ms),
        }
    }

    fn seen(&self) -> Vec<Seen> {
        self.log.lock().expect("read the log").clone()
    }

    fn calls(&self, method: &str, path: &str) -> Vec<Seen> {
        self.seen()
            .into_iter()
            .filter(|seen| seen.method == method && seen.path == path)
            .collect()
    }

    fn paths(&self) -> Vec<String> {
        self.seen().into_iter().map(|seen| seen.path).collect()
    }

    fn wait_for(&self, method: &str, path: &str) -> bool {
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
    let mut cookie = String::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 {
            break;
        }
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            match name.to_ascii_lowercase().as_str() {
                "content-length" => length = value.trim().parse().unwrap_or(0),
                "cookie" => cookie = value.trim().to_string(),
                _ => {}
            }
        }
    }

    let mut body = vec![0; length];
    if length > 0 && reader.read_exact(&mut body).is_err() {
        return;
    }

    let seen = Seen {
        method,
        path,
        cookie,
        body: String::from_utf8_lossy(&body).to_string(),
    };
    log.lock().expect("record the request").push(seen.clone());

    match route(&seen) {
        Act::Reply {
            status,
            json,
            set_cookie,
        } => {
            let reason = match status {
                200 => "OK",
                400 => "Bad Request",
                500 => "Internal Server Error",
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
        // A provider that never answers, and one that drops the socket: the chain
        // must tell those apart from a refusal.
        Act::Hang => std::thread::sleep(Duration::from_secs(2)),
        Act::Close => {}
    }
}

fn scripted(seen: &Seen) -> Act {
    match (seen.method.as_str(), seen.path.as_str()) {
        ("POST", "/auth/siwe/nonce") => Act::Reply {
            status: 200,
            json: r#"{"nonce":"nonce-1"}"#,
            set_cookie: None,
        },
        ("POST", "/auth/siwe/verify") => Act::Reply {
            status: 200,
            json: r#"{"address":"0x1111111111111111111111111111111111111111"}"#,
            set_cookie: Some(SET_COOKIE),
        },
        ("POST", "/auth/tokens") => Act::Reply {
            status: 200,
            json: r#"{"id":"pat-1","token":"pat-jwt"}"#,
            set_cookie: None,
        },
        ("POST", "/auth/tokens/exchange") => Act::Reply {
            status: 200,
            json: r#"{"accessToken":"access-token-1","expiresIn":3600}"#,
            set_cookie: None,
        },
        ("DELETE", "/auth/tokens/pat-1") => Act::Reply {
            status: 200,
            json: "{}",
            set_cookie: None,
        },
        _ => Act::Reply {
            status: 400,
            json: r#"{"error":"unexpected path"}"#,
            set_cookie: None,
        },
    }
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("a clock after 1970")
        .as_millis()
}

fn sign_in(upstream: &Upstream) -> Reply {
    let nonce = auth::nonce(upstream, ADDRESS);
    assert_eq!(nonce.status, 200, "nonce failed: {:?}", nonce.body);
    let message = nonce.body["message"]
        .as_str()
        .expect("the nonce reply carries a message")
        .to_string();
    auth::token(upstream, &message, SIGNATURE)
}

#[test]
fn one_cookie_carries_the_whole_chain() {
    let stub = Stub::start(scripted);
    let upstream = stub.upstream(2_000);

    let nonce = auth::nonce(&upstream, ADDRESS);
    assert_eq!(nonce.status, 200);
    let message = nonce.body["message"].as_str().expect("a message");
    let lines: Vec<&str> = message.split('\n').collect();
    assert_eq!(
        lines[0],
        "opensea.io wants you to sign in with your Ethereum account:"
    );
    assert_eq!(lines[1], ADDRESS);
    assert_eq!(lines[7], "Chain ID: 1");
    assert_eq!(lines[8], "Nonce: nonce-1");

    let before = now_ms();
    let reply = auth::token(&upstream, message, SIGNATURE);
    assert_eq!(reply.status, 200, "sign-in failed: {:?}", reply.body);
    assert_eq!(reply.body["token"], "access-token-1");
    let expires_at = reply.body["expiresAt"].as_u64().expect("a numeric expiry") as u128;
    assert!(
        expires_at >= before + 3_599_000 && expires_at <= now_ms() + 3_601_000,
        "expiry {expires_at} is not a computed hour"
    );

    let paths = stub.paths();
    assert_eq!(
        paths[..4],
        [
            "/auth/siwe/nonce",
            "/auth/siwe/verify",
            "/auth/tokens",
            "/auth/tokens/exchange"
        ]
    );

    // Verify is the call that sets the cookie. The nonce cannot carry one, so
    // every call after verify is the proof the session survived the chain.
    assert!(stub.calls("POST", "/auth/siwe/nonce")[0].cookie.is_empty());
    assert!(stub.calls("POST", "/auth/siwe/verify")[0].cookie.is_empty());
    for path in ["/auth/tokens", "/auth/tokens/exchange"] {
        assert_eq!(
            stub.calls("POST", path)[0].cookie,
            COOKIE_SENT,
            "path {path} lost the session cookie"
        );
    }

    let verify: serde_json::Value =
        serde_json::from_str(&stub.calls("POST", "/auth/siwe/verify")[0].body)
            .expect("a verify body");
    assert_eq!(verify["chainArch"], "EVM");
    assert_eq!(verify["signature"], SIGNATURE);
    assert_eq!(verify["message"]["domain"], "opensea.io");
    assert_eq!(verify["message"]["chainId"], "1");
    assert_eq!(verify["message"]["accountType"], "Ethereum");

    assert!(stub.wait_for("DELETE", "/auth/tokens/pat-1"), "no revoke");
    assert_eq!(
        stub.calls("DELETE", "/auth/tokens/pat-1")[0].cookie,
        COOKIE_SENT
    );
}

#[test]
fn an_entitlement_rejection_retries_exactly_once() {
    let created = Arc::new(AtomicUsize::new(0));
    let stub = Stub::start(move |seen: &Seen| {
        if (seen.method.as_str(), seen.path.as_str()) != ("POST", "/auth/tokens") {
            return scripted(seen);
        }
        let attempt = created.fetch_add(1, Ordering::SeqCst);
        if attempt == 0 {
            Act::Reply {
                status: 400,
                json: r#"{"errors":["Requested scopes exceed account entitlement"]}"#,
                set_cookie: None,
            }
        } else {
            Act::Reply {
                status: 200,
                json: r#"{"id":"pat-1","token":"pat-retried"}"#,
                set_cookie: None,
            }
        }
    });

    let reply = sign_in(&stub.upstream(2_000));

    assert_eq!(reply.status, 200, "sign-in failed: {:?}", reply.body);
    let attempts = stub.calls("POST", "/auth/tokens");
    assert_eq!(attempts.len(), 2);
    // The retry is not a second sign-in: it reuses the session the first attempt
    // established.
    for attempt in &attempts {
        assert_eq!(attempt.cookie, COOKIE_SENT);
    }
    let exchange: serde_json::Value =
        serde_json::from_str(&stub.calls("POST", "/auth/tokens/exchange")[0].body).expect("a body");
    assert_eq!(exchange["subjectToken"], "pat-retried");
}

#[test]
fn a_second_entitlement_rejection_does_not_retry() {
    let stub = Stub::start(|seen: &Seen| {
        if (seen.method.as_str(), seen.path.as_str()) == ("POST", "/auth/tokens") {
            return Act::Reply {
                status: 400,
                json: r#"{"errors":["Requested scopes exceed account entitlement"]}"#,
                set_cookie: None,
            };
        }
        scripted(seen)
    });

    let reply = sign_in(&stub.upstream(2_000));

    assert_eq!(reply.status, 502);
    let message = reply.body["error"].as_str().expect("an error message");
    assert!(message.contains("exceed account entitlement"), "{message}");
    assert_eq!(stub.calls("POST", "/auth/tokens").len(), 2);
    assert!(stub.calls("POST", "/auth/tokens/exchange").is_empty());
}

#[test]
fn a_timeout_and_a_dropped_connection_are_distinct() {
    let silent = Stub::start(|_: &Seen| Act::Hang);
    let timed_out = auth::nonce(&silent.upstream(60), ADDRESS);
    assert_eq!(timed_out.status, 504);
    assert_eq!(timed_out.body["error"], "OpenSea did not respond in time");

    let dropped = Stub::start(|_: &Seen| Act::Close);
    let failed = auth::nonce(&dropped.upstream(2_000), ADDRESS);
    assert_eq!(failed.status, 502);
    assert_eq!(failed.body["error"], "OpenSea request failed");
}

#[test]
fn a_failed_revoke_leaves_the_sign_in_alone() {
    let stub = Stub::start(|seen: &Seen| {
        if (seen.method.as_str(), seen.path.as_str()) == ("DELETE", "/auth/tokens/pat-1") {
            return Act::Reply {
                status: 500,
                json: r#"{"error":"revoke failed"}"#,
                set_cookie: None,
            };
        }
        scripted(seen)
    });

    let reply = sign_in(&stub.upstream(2_000));

    assert_eq!(reply.status, 200, "sign-in failed: {:?}", reply.body);
    assert_eq!(reply.body["token"], "access-token-1");
    assert!(stub.wait_for("DELETE", "/auth/tokens/pat-1"), "no revoke");
}

#[test]
fn bad_input_never_reaches_the_upstream() {
    let stub = Stub::start(scripted);
    let upstream = stub.upstream(2_000);

    let empty = auth::nonce(&upstream, "");
    assert_eq!(empty.status, 400);
    assert_eq!(empty.body["error"], "address is required");

    let layout = auth::token(&upstream, "velox deterministic sign-in", SIGNATURE);
    assert_eq!(layout.status, 400);
    assert_eq!(
        layout.body["error"],
        "message does not match the OpenSea sign-in layout"
    );

    let unsigned = auth::token(&upstream, "velox deterministic sign-in", "");
    assert_eq!(unsigned.status, 400);
    assert_eq!(unsigned.body["error"], "message and signature are required");

    assert!(stub.seen().is_empty(), "a bad request reached OpenSea");
}
