use core::time::Duration;

use bullmq::{options::RedisConnectionOptions, JobOptions, Queue, QueueOptions};
use uuid::Uuid;

use crate::{
    models::{JobData, ParityEventData},
    utils::{log_event, read_producer_definitions},
};

pub async fn create_jobs(port: u16) -> bullmq::Result<()> {
    let definitions = read_producer_definitions()?;

    let mut connection = RedisConnectionOptions::default();
    connection.url = format!("redis://localhost:{port}");

    log_event("ready".to_string(), None);

    for definition in definitions {
        let options = QueueOptions::default().connection(connection.clone());
        let queue = Queue::with_options(&definition.id, options).await?;

        let test_secret = Uuid::new_v4().to_string();
        for i in 0..definition.job.count {
            let job_name = format!("job-{i}");
            let job_secret = Uuid::new_v4().to_string();

            let job_data = JobData {
                job_secret,
                test_secret: test_secret.clone(),
            };

            let options = if definition.job.delay > 0 {
                JobOptions::default().delay(Duration::from_millis(definition.job.delay))
            } else {
                JobOptions::default()
            };

            queue
                .add(&job_name, job_data.clone())
                .options(options)
                .await?;

            log_event(
                "job-created".to_string(),
                ParityEventData::new_some(definition.id.clone(), job_name, job_data),
            );
        }
    }

    Ok(())
}
