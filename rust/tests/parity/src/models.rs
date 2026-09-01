use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub struct TestCaseWorkerSettings {
    #[serde(default)]
    pub concurrency: usize,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct TestCaseSimulationSettings {
    #[serde(default)]
    pub sleep: u64,
    #[serde(default)]
    pub fail: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ParityConsumerTestCase {
    pub id: String,
    pub worker: TestCaseWorkerSettings,
    pub simulation: TestCaseSimulationSettings,
}

#[derive(Debug, Deserialize)]
pub struct TestCaseJobSettings {
    pub count: usize,
    #[serde(default)]
    pub delay: u64,
}

#[derive(Debug, Deserialize)]
pub struct ParityProducerTestCase {
    pub id: String,
    pub job: TestCaseJobSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobData {
    pub job_secret: String,
    pub test_secret: String,
}

#[derive(Debug, Serialize)]
pub struct ParityEventData {
    pub timestamp: usize,
    pub test_id: String,
    pub job_name: String,
    pub job_secret: String,
    pub test_secret: String,
}

impl ParityEventData {
    pub fn new_some(test_id: String, job_name: String, data: JobData) -> Option<Self> {
        let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
        Some(Self {
            timestamp: timestamp.as_millis() as usize,
            test_id,
            job_name,
            job_secret: data.job_secret,
            test_secret: data.test_secret,
        })
    }
}
