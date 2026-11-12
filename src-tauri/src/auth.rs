use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::blocking::{Client, RequestBuilder, Response};
use serde_json::{json, Value};

use crate::siwe;

pub const OPENSEA_BASE_URL: &str = "https://api.opensea.io/api/v2";
const OPENSEA_TIMEOUT: Duration = Duration::from_secs(15);
const FAILED: &str = "OpenSea request failed";
const TIMED_OUT: &str = "OpenSea did not respond in time";

/// Where the chain points and how long it waits. Tests aim this at a stub and
/// shorten the deadline; the app uses `Default`.
pub struct Upstream {
    pub base_url: String,
    pub timeout: Duration,
}

impl Default for Upstream {
    fn default() -> Self {
        Self {
            base_url: OPENSEA_BASE_URL.to_string(),
            timeout: OPENSEA_TIMEOUT,
        }
    }
}

/// The one shape both lanes hand the caller: the status a caller can act on,
/// plus the JSON body the relay route would have sent.
pub struct Reply {
    pub status: u16,
    pub body: Value,
}

impl Reply {
    pub fn error(status: u16, message: &str) -> Reply {
        Reply {
            status,
            body: json!({ "error": message }),
        }
    }

    pub fn into_json(self) -> Value {
        json!({ "status": self.status, "body": self.body })
    }
}

pub fn nonce(upstream: &Upstream, address: &str) -> Reply {
    if address.is_empty() {
        return Reply::error(400, "address is required");
    }
    let Some(client) = client(upstream) else {
        return Reply::error(502, FAILED);
    };

    let issued = match settle(post(
        &client,
        upstream,
        "/auth/siwe/nonce",
        &json!({ "address": address }),
        None,
    )) {
        Ok(issued) => issued.body,
        Err(reply) => return reply,
    };
    let Some(nonce) = field(&issued, "nonce").filter(|nonce| !nonce.is_empty()) else {
        return unexpected("/auth/siwe/nonce");
    };

    let message = siwe::build(address, 1, nonce, &siwe::iso8601(now_ms()));
    Reply {
        status: 200,
        body: json!({ "message": message }),
    }
}

pub fn token(upstream: &Upstream, message: &str, signature: &str) -> Reply {
    if message.is_empty() || signature.is_empty() {
        return Reply::error(400, "message and signature are required");
    }
    let Some(fields) = siwe::parse(message) else {
        return Reply::error(400, "message does not match the OpenSea sign-in layout");
    };
    let Some(client) = client(upstream) else {
        return Reply::error(502, FAILED);
    };

    let verified = match settle(post(
        &client,
        upstream,
        "/auth/siwe/verify",
        &json!({ "message": fields.to_json(), "signature": signature, "chainArch": "EVM" }),
        None,
    )) {
        Ok(verified) => verified,
        Err(reply) => return reply,
    };

    let created = match create_token(&client, upstream, &verified.cookie) {
        Ok(created) => created,
        Err(reply) => return reply,
    };
    let pat_id = field(&created.body, "id").unwrap_or_default().to_string();

    let reply = exchange(&client, upstream, &created.body, &verified.cookie);
    if !pat_id.is_empty() {
        // The minted JWT outlives the PAT, so a stalled revoke must not delay a
        // token that already exists. Left alone, every sign-in would keep a
        // read:eligibility PAT alive for a day.
        let client = client.clone();
        let base_url = upstream.base_url.clone();
        let cookie = verified.cookie;
        std::thread::spawn(move || revoke(&client, &base_url, &pat_id, &cookie));
    }
    reply
}

fn exchange(client: &Client, upstream: &Upstream, created: &Value, cookie: &str) -> Reply {
    let Some(pat) = field(created, "token").filter(|pat| !pat.is_empty()) else {
        return unexpected("/auth/tokens");
    };
    let exchanged = match settle(post(
        client,
        upstream,
        "/auth/tokens/exchange",
        &json!({ "subjectToken": pat }),
        Some(cookie),
    )) {
        Ok(exchanged) => exchanged.body,
        Err(reply) => return reply,
    };
    let Some(token) = field(&exchanged, "accessToken").filter(|token| !token.is_empty()) else {
        return unexpected("/auth/tokens/exchange");
    };
    // The exchange schema makes expiresIn optional; the official SDK assumes an hour.
    let lifetime = exchanged
        .get("expiresIn")
        .and_then(Value::as_f64)
        .unwrap_or(3600.0);

    Reply {
        status: 200,
        body: json!({ "token": token, "expiresAt": now_ms() + (lifetime * 1000.0) as u64 }),
    }
}

fn create_token(client: &Client, upstream: &Upstream, cookie: &str) -> Result<Accepted, Reply> {
    let body = json!({ "label": "velox", "scopes": ["read:eligibility"], "expiresInDays": 1 });
    let first = post(client, upstream, "/auth/tokens", &body, Some(cookie));

    // A fresh SIWE session intermittently answers 400 "Requested scopes exceed
    // account entitlement" before the account is entitled; the same cookie
    // succeeds on the next call. Measured on 2 of 5 fresh sessions.
    let retry = match &first {
        Outcome::Refused { status: 400, .. } => {
            message_of(&first).contains("exceed account entitlement")
        }
        _ => false,
    };
    if !retry {
        return settle(first);
    }

    settle(post(client, upstream, "/auth/tokens", &body, Some(cookie)))
}

fn revoke(client: &Client, base_url: &str, id: &str, cookie: &str) {
    // A failed revoke leaves the PAT alive; the caller already holds its token.
    let _ = client
        .delete(format!("{base_url}/auth/tokens/{id}"))
        .header("accept", "application/json")
        .header("cookie", cookie)
        .send();
}

struct Accepted {
    body: Value,
    cookie: String,
}

enum Outcome {
    Ok(Accepted),
    TimedOut,
    Network,
    Refused {
        status: u16,
        status_text: String,
        text: String,
        body: Value,
    },
}

fn post(
    client: &Client,
    upstream: &Upstream,
    path: &str,
    payload: &Value,
    cookie: Option<&str>,
) -> Outcome {
    let mut request = client
        .post(format!("{}{path}", upstream.base_url))
        .header("accept", "application/json")
        .header("content-type", "application/json")
        .body(payload.to_string());
    if let Some(cookie) = cookie {
        request = request.header("cookie", cookie);
    }
    send(request)
}

fn send(request: RequestBuilder) -> Outcome {
    let response = match request.send() {
        Ok(response) => response,
        Err(error) if error.is_timeout() => return Outcome::TimedOut,
        Err(_) => return Outcome::Network,
    };

    let status = response.status();
    let status_text = status.canonical_reason().unwrap_or_default().to_string();
    let cookie = cookie_header(&response);
    // Read the body under the same deadline: the clock keeps running until the
    // last byte, as it does in the web lane.
    let text = match response.text() {
        Ok(text) => text,
        Err(error) if error.is_timeout() => return Outcome::TimedOut,
        Err(_) => return Outcome::Network,
    };
    let body = serde_json::from_str(&text).unwrap_or(Value::Null);

    if status.is_success() {
        return Outcome::Ok(Accepted { body, cookie });
    }
    Outcome::Refused {
        status: status.as_u16(),
        status_text,
        text,
        body,
    }
}

fn settle(outcome: Outcome) -> Result<Accepted, Reply> {
    match outcome {
        Outcome::Ok(accepted) => Ok(accepted),
        Outcome::TimedOut => Err(Reply::error(504, TIMED_OUT)),
        Outcome::Network => Err(Reply::error(502, FAILED)),
        refused @ Outcome::Refused { .. } => Err(Reply::error(502, &message_of(&refused))),
    }
}

// Rendered headers carry attributes, so only the name=value pairs belong in a
// request Cookie header.
fn cookie_header(response: &Response) -> String {
    response
        .headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .filter_map(|value| value.split(';').next())
        .map(str::trim)
        .collect::<Vec<_>>()
        .join("; ")
}

// The provider's own wording reaches the operator, so a refusal that names a
// scope, a key or a rate limit reads the same here as through the relay route.
fn message_of(outcome: &Outcome) -> String {
    let Outcome::Refused {
        status,
        status_text,
        text,
        body,
    } = outcome
    else {
        return String::new();
    };

    if let Some(message) = error_message(body) {
        return message;
    }
    let trimmed = text.trim();
    if trimmed.is_empty() {
        format!("{status} {status_text}").trim().to_string()
    } else {
        trimmed.to_string()
    }
}

fn error_message(body: &Value) -> Option<String> {
    let object = body.as_object()?;
    let first = object
        .get("errors")
        .and_then(Value::as_array)
        .and_then(|list| list.first())
        .and_then(Value::as_str)
        .filter(|message| !message.is_empty());
    if let Some(message) = first {
        return Some(message.to_string());
    }
    if let Some(message) = field(body, "error").filter(|message| !message.is_empty()) {
        return Some(message.to_string());
    }
    if let Some(message) = object
        .get("error")
        .and_then(Value::as_object)
        .and_then(|nested| nested.get("message"))
        .and_then(Value::as_str)
        .filter(|message| !message.is_empty())
    {
        return Some(message.to_string());
    }
    field(body, "message")
        .filter(|message| !message.is_empty())
        .map(str::to_string)
}

fn field<'a>(source: &'a Value, key: &str) -> Option<&'a str> {
    source.get(key).and_then(Value::as_str)
}

fn client(upstream: &Upstream) -> Option<Client> {
    Client::builder().timeout(upstream.timeout).build().ok()
}

fn unexpected(path: &str) -> Reply {
    Reply::error(502, &format!("unexpected response from {path}"))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}
