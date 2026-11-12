mod support;

use std::net::TcpListener;
use std::sync::{Arc, Barrier};
use std::time::Duration;

use support::{Act, Seen, Stub};
use velox_lib::price::{PriceService, Upstream};
use velox_lib::Reply;

const KEY: &str = "cmc-key-1";
const ROTATED_KEY: &str = "cmc-key-2";
const CONVERSION: &str = "/v2/tools/price-conversion?amount=1&id=1027&convert=USDT";

const ACCEPTED: &str = r#"{"data":{"id":1027,"symbol":"ETH","quote":{"USDT":{"price":3120.44,"last_updated":"2026-11-12T00:00:00.000Z"}}}}"#;
const ROTATED: &str = r#"{"data":{"id":1027,"symbol":"ETH","quote":{"USDT":{"price":3244.5,"last_updated":"2026-11-12T00:00:01.000Z"}}}}"#;
const RATE_LIMITED: &str = r#"{"status":{"error_message":"You have exceeded your rate limit"}}"#;
const LEAKY: &str = r#"{"status":{"error_message":"Invalid API key cmc-key-1 supplied"}}"#;

const REJECTED: &str = r#"{"status":{"error_message":"Invalid API key"}}"#;

fn answered(json: &'static str) -> impl Fn(&Seen) -> Act + Send + Sync + 'static {
    move |_: &Seen| Act::Reply {
        status: 200,
        json,
        set_cookie: None,
    }
}

fn service(stub: &Stub, timeout_ms: u64) -> PriceService {
    PriceService::new(Upstream {
        base_url: stub.base_url().to_string(),
        timeout: Duration::from_millis(timeout_ms),
        quote_window: Duration::from_secs(60),
    })
}

// Callers released together, so one shared flight rather than a lucky ordering
// is what keeps the upstream count at one.
fn race(service: &Arc<PriceService>, callers: usize, probe: bool) -> Vec<Reply> {
    let barrier = Arc::new(Barrier::new(callers));
    let handles: Vec<_> = (0..callers)
        .map(|_| {
            let service = Arc::clone(service);
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                barrier.wait();
                service.eth_usdt_price(KEY, probe)
            })
        })
        .collect();
    handles
        .into_iter()
        .map(|handle| handle.join().expect("a caller"))
        .collect()
}

#[test]
fn an_accepted_key_returns_the_quote_and_sends_the_header() {
    let stub = Stub::start(answered(ACCEPTED));

    let reply = service(&stub, 2_000).eth_usdt_price(KEY, false);

    assert_eq!(reply.status, 200, "{:?}", reply.body);
    assert_eq!(reply.body["price"], 3120.44);
    assert_eq!(reply.body["updatedAt"], "2026-11-12T00:00:00.000Z");

    let calls = stub.calls("GET", CONVERSION);
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].header("x-cmc_pro_api_key"), Some(KEY));
    assert_eq!(calls[0].header("accept"), Some("application/json"));
}

#[test]
fn a_rejected_key_and_a_forbidden_one_both_answer_401() {
    for status in [401u16, 403] {
        let stub = Stub::start(move |_: &Seen| Act::Reply {
            status,
            json: REJECTED,
            set_cookie: None,
        });

        let reply = service(&stub, 2_000).eth_usdt_price(KEY, false);

        assert_eq!(reply.status, 401, "upstream status {status}");
        assert_eq!(reply.body["error"], "CoinMarketCap rejected the key");
    }
}

#[test]
fn a_provider_body_quoting_the_key_never_reappears_in_the_reply() {
    let stub = Stub::start(|_: &Seen| Act::Reply {
        status: 500,
        json: LEAKY,
        set_cookie: None,
    });

    let reply = service(&stub, 2_000).eth_usdt_price(KEY, false);

    assert_eq!(reply.status, 502);
    assert_eq!(reply.body["error"], "Invalid API key [redacted] supplied");
    assert!(
        !reply.body.to_string().contains(KEY),
        "the key reached the reply: {:?}",
        reply.body
    );
}

#[test]
fn a_rate_limit_stays_429() {
    let stub = Stub::start(|_: &Seen| Act::Reply {
        status: 429,
        json: RATE_LIMITED,
        set_cookie: None,
    });

    let reply = service(&stub, 2_000).eth_usdt_price(KEY, false);

    assert_eq!(reply.status, 429);
    assert_eq!(reply.body["error"], "CoinMarketCap rate limit reached");
}

#[test]
fn a_timeout_and_a_dropped_connection_answer_502() {
    let silent = Stub::start(|_: &Seen| Act::Hang);
    let timed_out = service(&silent, 60).eth_usdt_price(KEY, false);
    assert_eq!(timed_out.status, 502);
    assert_eq!(timed_out.body["error"], "CoinMarketCap request failed");

    let port = {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind a closed port");
        listener.local_addr().expect("read the port").port()
    };
    let closed = PriceService::new(Upstream {
        base_url: format!("http://127.0.0.1:{port}"),
        timeout: Duration::from_millis(2_000),
        quote_window: Duration::from_secs(60),
    });
    let failed = closed.eth_usdt_price(KEY, false);
    assert_eq!(failed.status, 502);
    assert_eq!(failed.body["error"], "CoinMarketCap request failed");
}

#[test]
fn an_unparseable_success_answers_502_and_is_not_cached() {
    let stub = Stub::start(answered(r#"{"data":{"quote":{"USDT":{}}}}"#));
    let service = service(&stub, 2_000);

    let first = service.eth_usdt_price(KEY, false);
    assert_eq!(first.status, 502);
    assert_eq!(first.body["error"], "CoinMarketCap request failed");

    let second = service.eth_usdt_price(KEY, false);
    assert_eq!(second.status, 502);
    assert_eq!(
        stub.calls("GET", CONVERSION).len(),
        2,
        "a failed call was cached"
    );
}

#[test]
fn an_empty_key_never_reaches_the_upstream() {
    let stub = Stub::start(answered(ACCEPTED));
    let service = service(&stub, 2_000);

    for key in ["", "   "] {
        let reply = service.eth_usdt_price(key, false);
        assert_eq!(reply.status, 503, "key {key:?}");
        assert_eq!(reply.body["error"], "CMC_API_KEY is not set");
    }

    assert!(stub.seen().is_empty(), "an empty key reached the upstream");
}

#[test]
fn a_key_with_control_characters_never_reaches_the_upstream() {
    let stub = Stub::start(answered(ACCEPTED));
    let service = service(&stub, 2_000);

    for key in ["cmc-key\n1".to_string(), "k".repeat(129)] {
        let reply = service.eth_usdt_price(&key, false);
        assert_eq!(reply.status, 400, "key {key:?}");
        assert_eq!(reply.body["error"], "invalid CoinMarketCap key");
    }

    assert!(
        stub.seen().is_empty(),
        "an unusable key reached the upstream"
    );
}

#[test]
fn a_quote_is_cached_per_key() {
    let stub = Stub::start(answered(ACCEPTED));
    let service = service(&stub, 2_000);

    let first = service.eth_usdt_price(KEY, false);
    let second = service.eth_usdt_price(KEY, false);

    assert_eq!(first.status, 200);
    assert_eq!(second.body, first.body);
    assert_eq!(
        stub.calls("GET", CONVERSION).len(),
        1,
        "a fresh quote was fetched twice"
    );
}

#[test]
fn a_probe_skips_a_fresh_cache_entry() {
    let stub = Stub::start(answered(ACCEPTED));
    let service = service(&stub, 2_000);

    assert_eq!(service.eth_usdt_price(KEY, false).status, 200);
    assert_eq!(service.eth_usdt_price(KEY, true).status, 200);

    assert_eq!(
        stub.calls("GET", CONVERSION).len(),
        2,
        "a probe answered from the cache"
    );
}

#[test]
fn a_rotated_key_does_not_reuse_the_previous_quote() {
    let stub = Stub::start(|seen: &Seen| {
        let json = if seen.header("x-cmc_pro_api_key") == Some(ROTATED_KEY) {
            ROTATED
        } else {
            ACCEPTED
        };
        Act::Reply {
            status: 200,
            json,
            set_cookie: None,
        }
    });
    let service = service(&stub, 2_000);

    let first = service.eth_usdt_price(KEY, false);
    let second = service.eth_usdt_price(ROTATED_KEY, false);

    assert_eq!(first.body["price"], 3120.44);
    assert_eq!(
        second.body["price"], 3244.5,
        "a rotated key reused the previous key's quote"
    );
    assert_eq!(stub.calls("GET", CONVERSION).len(), 2);
}

#[test]
fn the_ninth_key_evicts_the_oldest() {
    let stub = Stub::start(answered(ACCEPTED));
    let service = service(&stub, 2_000);

    for index in 0..8 {
        assert_eq!(
            service
                .eth_usdt_price(&format!("key-{index}"), false)
                .status,
            200
        );
    }
    assert_eq!(service.eth_usdt_price("key-0", false).status, 200);
    assert_eq!(stub.calls("GET", CONVERSION).len(), 8);

    assert_eq!(service.eth_usdt_price("key-8", false).status, 200);
    assert_eq!(
        service.eth_usdt_price("key-1", false).status,
        200,
        "the ninth key evicted more than the oldest"
    );
    assert_eq!(
        stub.calls("GET", CONVERSION).len(),
        9,
        "the ninth key kept its neighbours cached"
    );

    assert_eq!(service.eth_usdt_price("key-0", false).status, 200);
    assert_eq!(
        stub.calls("GET", CONVERSION).len(),
        10,
        "the oldest key survived the ninth"
    );
}

#[test]
fn a_quote_expires_after_the_quote_window() {
    let stub = Stub::start(answered(ACCEPTED));
    let service = PriceService::new(Upstream {
        base_url: stub.base_url().to_string(),
        timeout: Duration::from_millis(2_000),
        quote_window: Duration::from_millis(100),
    });

    assert_eq!(service.eth_usdt_price(KEY, false).status, 200);
    std::thread::sleep(Duration::from_millis(150));
    assert_eq!(service.eth_usdt_price(KEY, false).status, 200);

    assert_eq!(
        stub.calls("GET", CONVERSION).len(),
        2,
        "an expired quote answered from the cache"
    );
}

#[test]
fn concurrent_misses_share_one_upstream_call() {
    let stub = Stub::start(|_: &Seen| Act::Delayed {
        status: 200,
        json: ACCEPTED,
        delay: Duration::from_millis(150),
    });
    let service = Arc::new(service(&stub, 2_000));

    let replies = race(&service, 4, false);

    let statuses: Vec<u16> = replies.iter().map(|reply| reply.status).collect();
    assert_eq!(statuses, [200u16, 200, 200, 200]);
    for reply in &replies {
        assert_eq!(reply.body["price"], 3120.44);
    }
    assert_eq!(
        stub.calls("GET", CONVERSION).len(),
        1,
        "concurrent misses each billed a call"
    );
}

#[test]
fn a_failed_call_reaches_every_waiter() {
    let stub = Stub::start(|_: &Seen| Act::Delayed {
        status: 429,
        json: RATE_LIMITED,
        delay: Duration::from_millis(150),
    });
    let service = Arc::new(service(&stub, 2_000));

    let replies = race(&service, 4, false);

    let statuses: Vec<u16> = replies.iter().map(|reply| reply.status).collect();
    assert_eq!(statuses, [429u16, 429, 429, 429]);
    assert_eq!(
        stub.calls("GET", CONVERSION).len(),
        1,
        "the waiters each called the upstream"
    );

    let retried = service.eth_usdt_price(KEY, false);
    assert_eq!(retried.status, 429);
    assert_eq!(
        stub.calls("GET", CONVERSION).len(),
        2,
        "a failed call was cached or reused"
    );
}

#[test]
fn a_probe_joins_the_in_flight_call_it_finds() {
    let stub = Stub::start(|_: &Seen| Act::Delayed {
        status: 200,
        json: ACCEPTED,
        delay: Duration::from_millis(150),
    });
    let service = Arc::new(service(&stub, 2_000));

    let leader = {
        let service = Arc::clone(&service);
        std::thread::spawn(move || service.eth_usdt_price(KEY, false))
    };
    assert!(
        stub.wait_for("GET", CONVERSION),
        "the first call never reached the upstream"
    );

    let probe = service.eth_usdt_price(KEY, true);
    let first = leader.join().expect("the first call");

    assert_eq!(first.status, 200);
    assert_eq!(probe.status, 200, "{:?}", probe.body);
    assert_eq!(probe.body, first.body);
    assert_eq!(
        stub.calls("GET", CONVERSION).len(),
        1,
        "a probe started its own call"
    );
}
