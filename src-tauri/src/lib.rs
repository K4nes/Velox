pub mod auth;
pub mod price;
pub mod reply;
pub mod siwe;

pub use reply::Reply;

use serde_json::Value;

// A sign-in is four upstream calls and can wait out a 15s deadline, so it runs
// off the thread that paints the window.
#[tauri::command]
async fn auth_nonce(address: String) -> Value {
    run(
        move || auth::nonce(&auth::Upstream::default(), &address),
        "sign-in failed",
    )
    .await
}

#[tauri::command]
async fn auth_token(message: String, signature: String) -> Value {
    run(
        move || auth::token(&auth::Upstream::default(), &message, &signature),
        "sign-in failed",
    )
    .await
}

// The key travels as an argument, never through the environment: the app reads
// it from the operator's browser store and hands it over per request.
#[tauri::command]
async fn eth_usdt_price(
    state: tauri::State<'_, std::sync::Arc<price::PriceService>>,
    key: Option<String>,
    probe: bool,
) -> Result<Value, String> {
    let service = state.inner().clone();
    Ok(run(
        move || service.eth_usdt_price(key.as_deref().unwrap_or(""), probe),
        "price request failed",
    )
    .await)
}

async fn run(task: impl FnOnce() -> Reply + Send + 'static, panic_message: &'static str) -> Value {
    match tauri::async_runtime::spawn_blocking(task).await {
        Ok(reply) => reply.into_json(),
        // The task only fails by panicking. A reply keeps the caller's shape, so a
        // broken chain still shows a status instead of an unreadable rejection.
        Err(_) => Reply::error(500, panic_message).into_json(),
    }
}

pub fn run_app() {
    tauri::Builder::default()
        .manage(std::sync::Arc::new(price::PriceService::default()))
        .invoke_handler(tauri::generate_handler![
            auth_nonce,
            auth_token,
            eth_usdt_price
        ])
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .run(tauri::generate_context!())
        .expect("failed to start Velox");
}
