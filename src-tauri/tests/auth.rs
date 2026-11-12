mod support;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use support::{Act, Seen, Stub};
use velox_lib::auth::{self, Upstream};
use velox_lib::siwe;
use velox_lib::Reply;

const ADDRESS: &str = "0x1111111111111111111111111111111111111111";
const SIGNATURE: &str = "0xsigned";
const SET_COOKIE: &str = "oa=session-1; Path=/; HttpOnly";
const COOKIE_SENT: &str = "oa=session-1";

fn upstream(stub: &Stub, timeout_ms: u64) -> Upstream {
    Upstream {
        base_url: stub.base_url().to_string(),
        timeout: Duration::from_millis(timeout_ms),
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
    let upstream = upstream(&stub, 2_000);

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

    let reply = sign_in(&upstream(&stub, 2_000));

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

    let reply = sign_in(&upstream(&stub, 2_000));

    assert_eq!(reply.status, 502);
    let message = reply.body["error"].as_str().expect("an error message");
    assert!(message.contains("exceed account entitlement"), "{message}");
    assert_eq!(stub.calls("POST", "/auth/tokens").len(), 2);
    assert!(stub.calls("POST", "/auth/tokens/exchange").is_empty());
}

#[test]
fn a_timeout_and_a_dropped_connection_are_distinct() {
    let silent = Stub::start(|_: &Seen| Act::Hang);
    let timed_out = auth::nonce(&upstream(&silent, 60), ADDRESS);
    assert_eq!(timed_out.status, 504);
    assert_eq!(timed_out.body["error"], "OpenSea did not respond in time");

    let dropped = Stub::start(|_: &Seen| Act::Close);
    let failed = auth::nonce(&upstream(&dropped, 2_000), ADDRESS);
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

    let reply = sign_in(&upstream(&stub, 2_000));

    assert_eq!(reply.status, 200, "sign-in failed: {:?}", reply.body);
    assert_eq!(reply.body["token"], "access-token-1");
    assert!(stub.wait_for("DELETE", "/auth/tokens/pat-1"), "no revoke");
}

#[test]
fn bad_input_never_reaches_the_upstream() {
    let stub = Stub::start(scripted);
    let upstream = upstream(&stub, 2_000);

    let empty = auth::nonce(&upstream, "");
    assert_eq!(empty.status, 400);
    assert_eq!(empty.body["error"], "address is required");

    let layout = auth::token(&upstream, "velox deterministic sign-in", SIGNATURE);
    assert_eq!(layout.status, 400);
    assert_eq!(
        layout.body["error"],
        "message does not match the OpenSea sign-in layout"
    );

    assert!(stub.seen().is_empty(), "a bad request reached OpenSea");
}

#[test]
fn an_empty_signature_reaches_the_upstream() {
    let stub = Stub::start(scripted);

    // The web lane forwards whatever signature string it is handed and lets the
    // provider refuse it, so the command must not answer with a message of its
    // own: the parse passes and the verify call still arrives.
    let message = siwe::build(ADDRESS, 1, "nonce-1", &siwe::iso8601(1_700_000_000_000));
    auth::token(&upstream(&stub, 2_000), &message, "");

    assert_eq!(
        stub.calls("POST", "/auth/siwe/verify").len(),
        1,
        "an empty signature did not reach OpenSea"
    );
}
