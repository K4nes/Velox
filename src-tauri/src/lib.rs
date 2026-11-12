pub mod auth;
pub mod siwe;

use serde_json::Value;

// A sign-in is four upstream calls and can wait out a 15s deadline, so it runs
// off the thread that paints the window.
#[tauri::command]
async fn auth_nonce(address: String) -> Value {
  run(move || auth::nonce(&auth::Upstream::default(), &address)).await
}

#[tauri::command]
async fn auth_token(message: String, signature: String) -> Value {
  run(move || auth::token(&auth::Upstream::default(), &message, &signature)).await
}

async fn run(task: impl FnOnce() -> auth::Reply + Send + 'static) -> Value {
  match tauri::async_runtime::spawn_blocking(task).await {
    Ok(reply) => reply.into_json(),
    // The task only fails by panicking. A reply keeps the caller's shape, so a
    // broken chain still shows a status instead of an unreadable rejection.
    Err(_) => auth::Reply::error(500, "sign-in failed").into_json(),
  }
}

pub fn run_app() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![auth_nonce, auth_token])
    .run(tauri::generate_context!())
    .expect("failed to start Velox");
}
