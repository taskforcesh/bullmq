use std::sync::Arc;
use tokio::{
    task::JoinSet,
    time::{sleep, Duration},
};

use bullmq::{
    options::RedisConnectionOptions,
    worker::{CancellationToken, ProcessorFn},
    Job, Worker, WorkerOptions,
};

use crate::{
    models::{JobData, ParityConsumerTestCase, ParityEventData},
    utils::{self, log_event},
};

async fn run_worker(port: u16, definition: Arc<ParityConsumerTestCase>) -> bullmq::Result<Worker> {
    let def_for_closure = Arc::clone(&definition);

    let processor: ProcessorFn = Arc::new(move |job: Job, _token: CancellationToken| {
        let definition = Arc::clone(&def_for_closure);
        Box::pin(async move {
            let job_data = serde_json::from_value::<JobData>(job.data().to_owned()).unwrap();

            log_event(
                "job-started".to_string(),
                ParityEventData::new_some(
                    definition.id.clone(),
                    job.name().to_string(),
                    job_data.clone(),
                ),
            );
            if definition.simulation.sleep > 0 {
                sleep(Duration::from_millis(definition.simulation.sleep)).await;
            }

            if job.attempts_made() < definition.simulation.fail {
                return Err(bullmq::Error::ProcessingError(
                    "Simulated failure".to_string(),
                ));
            }

            log_event(
                "job-completed".to_string(),
                ParityEventData::new_some(definition.id.clone(), job.name().to_string(), job_data),
            );

            // Check logic here
            Ok(serde_json::json!(null))
        })
    });

    let mut concurrency = 1;
    if definition.worker.concurrency > 1 {
        concurrency = definition.worker.concurrency;
    }

    let mut connection = RedisConnectionOptions::default();
    connection.url = format!("redis://localhost:{port}");

    let options = WorkerOptions::default()
        .concurrency(concurrency)
        .connection(connection);

    let worker = Worker::with_options(&definition.id, processor, options).await?;

    while let Some(_) = worker.next_event().await {
        // Do nothing, keeps the loop active
    }

    Ok(worker)
}

pub async fn setup_workers(port: u16) -> bullmq::Result<()> {
    let definitions = utils::read_consumer_definitions()?;
    let mut set = JoinSet::new();
    for definition in definitions {
        set.spawn(async move { run_worker(port, Arc::new(definition)).await });
    }

    log_event("ready".to_string(), None);

    set.join_all().await;

    Ok(())
}
