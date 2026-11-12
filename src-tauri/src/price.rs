use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use reqwest::blocking::Client;
use serde_json::{json, Value};

use crate::Reply;

pub const CMC_BASE_URL: &str = "https://pro-api.coinmarketcap.com";
const CONVERSION: &str = "/v2/tools/price-conversion?amount=1&id=1027&convert=USDT";
pub const QUOTE_WINDOW: Duration = Duration::from_secs(60);
const MAX_CACHED_KEYS: usize = 8;
const MAX_KEY_LENGTH: usize = 128;
const TIMEOUT: Duration = Duration::from_secs(15);
const FAILED: &str = "CoinMarketCap request failed";
const REDACTED: &str = "[redacted]";

/// Where the quote comes from, how long it waits, and how long a cached answer
/// stays good. Tests aim this at a stub and shorten the window; the app uses
/// `Default`.
pub struct Upstream {
    pub base_url: String,
    pub timeout: Duration,
    pub quote_window: Duration,
}

impl Default for Upstream {
    fn default() -> Self {
        Self {
            base_url: CMC_BASE_URL.to_string(),
            timeout: TIMEOUT,
            quote_window: QUOTE_WINDOW,
        }
    }
}

#[derive(Clone)]
pub struct Quote {
    pub price: f64,
    pub updated_at: String,
}

impl Quote {
    fn to_json(&self) -> Value {
        json!({ "price": self.price, "updatedAt": self.updated_at })
    }
}

pub struct PriceService {
    upstream: Upstream,
    // One lock covers both halves: the entries a call may answer from and the
    // calls already in flight for a key.
    cache: Mutex<Cache>,
}

impl Default for PriceService {
    fn default() -> Self {
        Self::new(Upstream::default())
    }
}

impl PriceService {
    pub fn new(upstream: Upstream) -> Self {
        Self {
            upstream,
            cache: Mutex::new(Cache::default()),
        }
    }

    pub fn eth_usdt_price(&self, key: &str, probe: bool) -> Reply {
        let key = key.trim();
        if key.is_empty() {
            return Reply::error(503, "CMC_API_KEY is not set");
        }
        if key.len() > MAX_KEY_LENGTH || key.chars().any(char::is_control) {
            return Reply::error(400, "invalid CoinMarketCap key");
        }

        let (flight, leader) = {
            let mut cache = lock(&self.cache);
            if !probe {
                if let Some(quote) = cache.fresh(key, self.upstream.quote_window) {
                    return Reply {
                        status: 200,
                        body: quote.to_json(),
                    };
                }
            }
            match cache.flights.get(key) {
                Some(flight) => (flight.clone(), false),
                None => {
                    let flight = Arc::new(Flight::default());
                    cache.flights.insert(key.to_string(), flight.clone());
                    (flight, true)
                }
            }
        };

        if !leader {
            return flight.wait();
        }

        let landing = Landing::new(flight, &self.cache, key);
        let (reply, quote) = exchange(&self.upstream, key);
        {
            let mut cache = lock(&self.cache);
            if let Some(quote) = quote {
                cache.store(key, quote);
            }
        }
        landing.publish(reply.clone());
        reply
    }
}

#[derive(Default)]
struct Cache {
    entries: VecDeque<Entry>,
    flights: HashMap<String, Arc<Flight>>,
}

impl Cache {
    fn fresh(&self, key: &str, window: Duration) -> Option<Quote> {
        self.entries
            .iter()
            .find(|entry| entry.key == key && entry.at.elapsed() < window)
            .map(|entry| entry.quote.clone())
    }

    fn store(&mut self, key: &str, quote: Quote) {
        self.entries.retain(|entry| entry.key != key);
        self.entries.push_back(Entry {
            key: key.to_string(),
            quote,
            at: Instant::now(),
        });
        // Rotation would otherwise pin every retired key for the process's life.
        while self.entries.len() > MAX_CACHED_KEYS {
            self.entries.pop_front();
        }
    }
}

struct Entry {
    key: String,
    quote: Quote,
    at: Instant,
}

#[derive(Default)]
struct Flight {
    answer: Mutex<Answer>,
    landed: Condvar,
}

impl Flight {
    fn land(&self, reply: Reply) {
        let mut answer = lock(&self.answer);
        if matches!(*answer, Answer::Pending) {
            *answer = Answer::Landed(reply);
        }
        drop(answer);
        self.landed.notify_all();
    }

    fn wait(&self) -> Reply {
        let mut answer = lock(&self.answer);
        loop {
            if let Answer::Landed(reply) = &*answer {
                return reply.clone();
            }
            answer = self
                .landed
                .wait(answer)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
        }
    }
}

#[derive(Default)]
enum Answer {
    #[default]
    Pending,
    Landed(Reply),
}

/// Publishes the leader's whole reply when it finishes, and a fallback when it
/// panics first. The flight leaves the cache on both paths, so a panic cannot
/// pin a key to a stale 502 for the life of the process.
struct Landing<'a> {
    flight: Arc<Flight>,
    cache: &'a Mutex<Cache>,
    key: &'a str,
    reply: Option<Reply>,
}

impl<'a> Landing<'a> {
    fn new(flight: Arc<Flight>, cache: &'a Mutex<Cache>, key: &'a str) -> Self {
        Self {
            flight,
            cache,
            key,
            reply: None,
        }
    }

    fn publish(mut self, reply: Reply) {
        self.reply = Some(reply);
    }
}

impl Drop for Landing<'_> {
    fn drop(&mut self) {
        let reply = self
            .reply
            .take()
            .unwrap_or_else(|| Reply::error(502, FAILED));
        lock(self.cache).flights.remove(self.key);
        self.flight.land(reply);
    }
}

fn exchange(upstream: &Upstream, key: &str) -> (Reply, Option<Quote>) {
    let Some(client) = client(upstream) else {
        return (Reply::error(502, FAILED), None);
    };
    let url = format!("{}{CONVERSION}", upstream.base_url.trim_end_matches('/'));
    let response = client
        .get(url)
        .header("X-CMC_PRO_API_KEY", key)
        .header("accept", "application/json")
        .send();
    let Ok(response) = response else {
        return (Reply::error(502, FAILED), None);
    };

    let status = response.status().as_u16();
    let Ok(text) = response.text() else {
        return (Reply::error(502, FAILED), None);
    };
    let body: Value = serde_json::from_str(&text).unwrap_or(Value::Null);

    match status {
        // The provider answers a bad key with its own message, which can quote
        // the key back, so both refusals collapse to one fixed sentence.
        401 | 403 => (Reply::error(401, "CoinMarketCap rejected the key"), None),
        429 => (Reply::error(429, "CoinMarketCap rate limit reached"), None),
        200 => match quote_of(&body) {
            Some(quote) => (
                Reply {
                    status: 200,
                    body: quote.to_json(),
                },
                Some(quote),
            ),
            None => (Reply::error(502, FAILED), None),
        },
        _ => (Reply::error(502, &failure_message(&body, key)), None),
    }
}

fn quote_of(body: &Value) -> Option<Quote> {
    let usdt = body.get("data")?.get("quote")?.get("USDT")?;
    let price = usdt
        .get("price")
        .and_then(Value::as_f64)
        .filter(|price| price.is_finite())?;
    let updated_at = usdt
        .get("last_updated")
        .and_then(Value::as_str)
        .filter(|updated_at| !updated_at.is_empty())?;
    Some(Quote {
        price,
        updated_at: updated_at.to_string(),
    })
}

// The provider's wording reaches a toast, and it can quote the key back inside
// it, so every occurrence is scrubbed on the way out.
fn failure_message(body: &Value, key: &str) -> String {
    match error_message(body) {
        Some(message) => message.replace(key, REDACTED),
        None => FAILED.to_string(),
    }
}

fn error_message(body: &Value) -> Option<&str> {
    body.get("status")
        .and_then(|status| status.get("error_message"))
        .and_then(Value::as_str)
        .filter(|message| !message.is_empty())
}

fn client(upstream: &Upstream) -> Option<Client> {
    Client::builder().timeout(upstream.timeout).build().ok()
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
