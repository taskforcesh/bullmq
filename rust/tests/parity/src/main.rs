use std::env;

use crate::utils::log_event;

mod consumer;
mod models;
mod producer;
mod utils;

#[tokio::main]
async fn main() -> bullmq::Result<()> {
    let backend = env::var("PARITY_BACKEND").unwrap();
    if backend == "postgres" {
        log_event("not-supported".to_string(), None);
        return Ok(());
    }

    let backend_port = env::var("PARITY_BACKEND_PORT")
        .unwrap()
        .parse::<u16>()
        .unwrap();

    let mode = env::args().nth(1).unwrap();

    if mode == "--producer" {
        producer::create_jobs(backend_port).await?
    } else if mode == "--consumer" {
        consumer::setup_workers(backend_port).await?;
    } else {
        panic!("Unrecognized running mode {mode}, expected --consumer or --producer");
    }

    Ok(())
}
