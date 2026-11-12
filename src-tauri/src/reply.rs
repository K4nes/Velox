use serde_json::{json, Value};

/// The one shape every lane hands the caller: the status a caller can act on,
/// plus the JSON body the relay route would have sent.
#[derive(Clone)]
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
