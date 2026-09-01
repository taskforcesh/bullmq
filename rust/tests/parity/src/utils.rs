use std::{env, fs};

use crate::models::{ParityConsumerTestCase, ParityEventData, ParityProducerTestCase};

fn read_definitions_file() -> String {
    fs::read_to_string("../../../parity/definitions.json").unwrap()
}

pub fn read_producer_definitions() -> bullmq::Result<Vec<ParityProducerTestCase>> {
    let definitions_str = read_definitions_file();

    let items: Vec<ParityProducerTestCase> = serde_json::from_str(&definitions_str)?;

    Ok(items)
}

pub fn read_consumer_definitions() -> bullmq::Result<Vec<ParityConsumerTestCase>> {
    let definitions_str = read_definitions_file();

    let items: Vec<ParityConsumerTestCase> = serde_json::from_str(&definitions_str)?;

    Ok(items)
}

pub fn log_event(event_type: String, data: Option<ParityEventData>) {
    let run_id = env::var("PARITY_RUN_ID").unwrap();
    let event = serde_json::json!({
        "type": event_type,
        "run_id": run_id,
        "data": data,
    });

    println!("{}", serde_json::to_string(&event).unwrap());
}
