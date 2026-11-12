// `/auth/siwe/verify` accepts only this exact message, so the layout below is
// OpenSea's sign-in format, not a local choice. `parse` checks the fixed lines,
// the header, statement, URI, version and line count, before the request is
// forwarded.
const DOMAIN: &str = "opensea.io";
const ACCOUNT_TYPE: &str = "Ethereum";
const STATEMENT: &str = "Click to sign in and accept the Platform Terms of Service (https://opensea.io/tos) and Privacy Policy (https://opensea.io/privacy).";
const URI: &str = "https://opensea.io";
const VERSION: &str = "1";

pub struct Fields {
  pub domain: &'static str,
  pub address: String,
  pub statement: &'static str,
  pub uri: &'static str,
  pub version: &'static str,
  pub chain_id: String,
  pub nonce: String,
  pub issued_at: String,
  pub account_type: &'static str,
}

impl Fields {
  pub fn to_json(&self) -> serde_json::Value {
    serde_json::json!({
      "domain": self.domain,
      "address": self.address,
      "statement": self.statement,
      "uri": self.uri,
      "version": self.version,
      "chainId": self.chain_id,
      "nonce": self.nonce,
      "issuedAt": self.issued_at,
      "accountType": self.account_type,
    })
  }
}

pub fn build(address: &str, chain_id: u64, nonce: &str, issued_at: &str) -> String {
  let header = format!("{DOMAIN} wants you to sign in with your {ACCOUNT_TYPE} account:");
  [
    header.as_str(),
    address,
    "",
    STATEMENT,
    "",
    &format!("URI: {URI}"),
    &format!("Version: {VERSION}"),
    &format!("Chain ID: {chain_id}"),
    &format!("Nonce: {nonce}"),
    &format!("Issued At: {issued_at}"),
  ]
  .join("\n")
}

pub fn parse(message: &str) -> Option<Fields> {
  let lines: Vec<&str> = message.split('\n').collect();
  if lines.len() != 10 {
    return None;
  }

  let header = format!("{DOMAIN} wants you to sign in with your {ACCOUNT_TYPE} account:");
  if lines[0] != header {
    return None;
  }
  if lines[1].is_empty() || !lines[2].is_empty() || !lines[4].is_empty() {
    return None;
  }
  if lines[3] != STATEMENT {
    return None;
  }
  if lines[5] != format!("URI: {URI}") || lines[6] != format!("Version: {VERSION}") {
    return None;
  }

  Some(Fields {
    domain: DOMAIN,
    address: lines[1].to_string(),
    statement: STATEMENT,
    uri: URI,
    version: VERSION,
    chain_id: value_after(lines[7], "Chain ID: ")?,
    nonce: value_after(lines[8], "Nonce: ")?,
    issued_at: value_after(lines[9], "Issued At: ")?,
    account_type: ACCOUNT_TYPE,
  })
}

fn value_after(line: &str, prefix: &str) -> Option<String> {
  let value = line.strip_prefix(prefix)?;
  if value.is_empty() {
    None
  } else {
    Some(value.to_string())
  }
}

/// `Date.prototype.toISOString` layout, so both lanes send the same bytes.
pub fn iso8601(millis: u64) -> String {
  let seconds = millis / 1000;
  let millis_part = millis % 1000;
  let days = (seconds / 86_400) as i64;
  let time = seconds % 86_400;
  let (year, month, day) = civil_from_days(days);
  format!(
    "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis_part:03}Z",
    time / 3600,
    (time % 3600) / 60,
    time % 60
  )
}

// Howard Hinnant's civil_from_days. A calendar dependency would be larger than
// the arithmetic it replaces, and this is the only date this crate formats.
fn civil_from_days(days: i64) -> (i64, u64, u64) {
  let shifted = days + 719_468;
  let era = if shifted >= 0 { shifted } else { shifted - 146_096 } / 146_097;
  let day_of_era = (shifted - era * 146_097) as u64;
  let year_of_era =
    (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
  let year = year_of_era as i64 + era * 400;
  let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
  let shifted_month = (5 * day_of_year + 2) / 153;
  let day = day_of_year - (153 * shifted_month + 2) / 5 + 1;
  let month = if shifted_month < 10 {
    shifted_month + 3
  } else {
    shifted_month - 9
  };
  (if month <= 2 { year + 1 } else { year }, month, day)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn formats_the_iso_layout_the_web_lane_sends() {
    assert_eq!(iso8601(0), "1970-01-01T00:00:00.000Z");
    assert_eq!(iso8601(1_760_000_000_000), "2025-10-09T08:53:20.000Z");
    assert_eq!(iso8601(1_709_164_800_123), "2024-02-29T00:00:00.123Z");
  }

  #[test]
  fn builds_a_message_its_own_parser_accepts() {
    let message = build("0xabc", 1, "nonce-1", "2025-10-09T08:53:20.000Z");
    let fields = parse(&message).expect("the built message parses");
    assert_eq!(fields.address, "0xabc");
    assert_eq!(fields.chain_id, "1");
    assert_eq!(fields.nonce, "nonce-1");
    assert_eq!(fields.issued_at, "2025-10-09T08:53:20.000Z");
  }

  #[test]
  fn rejects_a_message_that_is_not_the_opensea_layout() {
    let message = build("0xabc", 1, "nonce-1", "2025-10-09T08:53:20.000Z");
    assert!(parse(&message.replace("Nonce: nonce-1", "Nonce: ")).is_none());
    assert!(parse(&message.replace("Chain ID: 1", "Chain ID: 137")).is_some());
    assert!(parse(&format!("{message}\nextra")).is_none());
    assert!(parse("velox deterministic sign-in").is_none());
  }
}
