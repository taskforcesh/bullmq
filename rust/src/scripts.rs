use redis::aio::MultiplexedConnection;
use sha1::{Digest, Sha1};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use crate::error::Error;

/// A single loaded Lua script with its metadata.
#[derive(Debug, Clone)]
pub struct LuaScript {
    /// The script name (e.g., "addStandardJob").
    pub name: String,
    /// Number of KEYS arguments the script expects.
    pub num_keys: usize,
    /// The Lua source code.
    pub content: String,
    /// SHA1 hash of the script content.
    pub sha: String,
}

impl LuaScript {
    /// Create a new Lua script from name, key count, and content.
    pub fn new(name: &str, num_keys: usize, content: &str) -> Self {
        let sha = compute_sha1(content);
        Self {
            name: name.to_string(),
            num_keys,
            content: content.to_string(),
            sha,
        }
    }

    /// Execute this script via EVALSHA, falling back to EVAL on NOSCRIPT.
    pub async fn execute(
        &self,
        conn: &mut MultiplexedConnection,
        keys: &[impl redis::ToRedisArgs],
        args: &[impl redis::ToRedisArgs],
    ) -> Result<redis::Value, Error> {
        // Build EVALSHA command
        let mut cmd = redis::cmd("EVALSHA");
        cmd.arg(&self.sha).arg(self.num_keys);
        for key in keys {
            cmd.arg(key);
        }
        for arg in args {
            cmd.arg(arg);
        }

        match cmd.query_async::<redis::Value>(conn).await {
            Ok(val) => Ok(val),
            Err(e) => {
                // Check for NOSCRIPT error - fall back to EVAL
                if e.kind() == redis::ErrorKind::Server(redis::ServerErrorKind::NoScript) {
                    let mut eval_cmd = redis::cmd("EVAL");
                    eval_cmd.arg(self.content.as_str()).arg(self.num_keys);
                    for key in keys {
                        eval_cmd.arg(key);
                    }
                    for arg in args {
                        eval_cmd.arg(arg);
                    }
                    Ok(eval_cmd.query_async::<redis::Value>(conn).await?)
                } else {
                    Err(Error::Redis(e))
                }
            }
        }
    }
}

/// Registry of all BullMQ Lua scripts.
///
/// Scripts execute via EVALSHA and lazily fall back to EVAL on NOSCRIPT.
/// For pipelined operations where that fallback is not available, callers can
/// ensure specific scripts are loaded ahead of time.
#[derive(Debug, Clone)]
pub struct ScriptRegistry {
    scripts: Arc<HashMap<String, LuaScript>>,
}

impl ScriptRegistry {
    /// Create a new registry and load all embedded scripts.
    pub fn new() -> Self {
        let mut scripts = HashMap::new();

        // Load the compiled Lua scripts from `rust/src/commands/` (includes already resolved).
        for (name, num_keys, content) in Self::embedded_scripts() {
            let script = LuaScript::new(name, num_keys, content);
            scripts.insert(name.to_string(), script);
        }

        Self {
            scripts: Arc::new(scripts),
        }
    }

    /// Get a script by name.
    pub fn get(&self, name: &str) -> Option<&LuaScript> {
        self.scripts.get(name)
    }

    /// Get all script names.
    pub fn names(&self) -> Vec<&str> {
        self.scripts.keys().map(|s| s.as_str()).collect()
    }

    /// Ensure the named scripts are loaded into Redis using SCRIPT LOAD.
    ///
    /// This is intended for pipelined operations where EVALSHA must succeed
    /// without a NOSCRIPT -> EVAL fallback round trip.
    pub async fn ensure_loaded(
        &self,
        conn: &mut MultiplexedConnection,
        names: &[&str],
    ) -> Result<(), crate::error::Error> {
        let mut seen = HashSet::new();
        for name in names {
            let Some(script) = self.scripts.get(*name) else {
                continue;
            };
            if !seen.insert(script.sha.as_str()) {
                continue;
            }

            redis::cmd("SCRIPT")
                .arg("LOAD")
                .arg(script.content.as_str())
                .query_async::<String>(conn)
                .await?;
        }
        Ok(())
    }

    /// Returns the embedded compiled Lua scripts as (name, num_keys, content) tuples.
    ///
    /// These are the fully resolved scripts from `rust/src/commands/` (all includes expanded).
    fn embedded_scripts() -> Vec<(&'static str, usize, &'static str)> {
        vec![
            (
                "addStandardJob",
                9,
                include_str!("commands/addStandardJob-9.lua"),
            ),
            (
                "addDelayedJob",
                6,
                include_str!("commands/addDelayedJob-6.lua"),
            ),
            (
                "addPrioritizedJob",
                9,
                include_str!("commands/addPrioritizedJob-9.lua"),
            ),
            (
                "addParentJob",
                6,
                include_str!("commands/addParentJob-6.lua"),
            ),
            ("addLog", 2, include_str!("commands/addLog-2.lua")),
            (
                "moveToActive",
                11,
                include_str!("commands/moveToActive-11.lua"),
            ),
            (
                "moveToFinished",
                14,
                include_str!("commands/moveToFinished-14.lua"),
            ),
            (
                "moveToDelayed",
                12,
                include_str!("commands/moveToDelayed-12.lua"),
            ),
            (
                "moveToWaitingChildren",
                7,
                include_str!("commands/moveToWaitingChildren-7.lua"),
            ),
            (
                "moveStalledJobsToWait",
                9,
                include_str!("commands/moveStalledJobsToWait-9.lua"),
            ),
            (
                "moveJobFromActiveToWait",
                9,
                include_str!("commands/moveJobFromActiveToWait-9.lua"),
            ),
            (
                "moveJobsToWait",
                8,
                include_str!("commands/moveJobsToWait-8.lua"),
            ),
            ("extendLock", 2, include_str!("commands/extendLock-2.lua")),
            ("extendLocks", 1, include_str!("commands/extendLocks-1.lua")),
            ("releaseLock", 1, include_str!("commands/releaseLock-1.lua")),
            ("getCounts", 1, include_str!("commands/getCounts-1.lua")),
            ("getState", 8, include_str!("commands/getState-8.lua")),
            ("getStateV2", 8, include_str!("commands/getStateV2-8.lua")),
            ("getJobs", 1, include_str!("commands/getJobs-1.lua")),
            ("getRanges", 1, include_str!("commands/getRanges-1.lua")),
            (
                "getRateLimitTtl",
                2,
                include_str!("commands/getRateLimitTtl-2.lua"),
            ),
            ("isFinished", 3, include_str!("commands/isFinished-3.lua")),
            ("isJobInList", 1, include_str!("commands/isJobInList-1.lua")),
            ("isMaxed", 2, include_str!("commands/isMaxed-2.lua")),
            ("pause", 7, include_str!("commands/pause-7.lua")),
            ("drain", 5, include_str!("commands/drain-5.lua")),
            ("obliterate", 2, include_str!("commands/obliterate-2.lua")),
            ("removeJob", 2, include_str!("commands/removeJob-2.lua")),
            (
                "removeJobScheduler",
                3,
                include_str!("commands/removeJobScheduler-3.lua"),
            ),
            (
                "cleanJobsInSet",
                3,
                include_str!("commands/cleanJobsInSet-3.lua"),
            ),
            ("updateData", 1, include_str!("commands/updateData-1.lua")),
            (
                "updateProgress",
                3,
                include_str!("commands/updateProgress-3.lua"),
            ),
            (
                "saveStacktrace",
                1,
                include_str!("commands/saveStacktrace-1.lua"),
            ),
            ("retryJob", 11, include_str!("commands/retryJob-11.lua")),
            ("promote", 9, include_str!("commands/promote-9.lua")),
            ("changeDelay", 4, include_str!("commands/changeDelay-4.lua")),
            (
                "changePriority",
                7,
                include_str!("commands/changePriority-7.lua"),
            ),
            (
                "addJobScheduler",
                11,
                include_str!("commands/addJobScheduler-11.lua"),
            ),
            (
                "updateJobScheduler",
                12,
                include_str!("commands/updateJobScheduler-12.lua"),
            ),
            (
                "getJobScheduler",
                1,
                include_str!("commands/getJobScheduler-1.lua"),
            ),
            (
                "removeDeduplicationKey",
                1,
                include_str!("commands/removeDeduplicationKey-1.lua"),
            ),
            ("paginate", 1, include_str!("commands/paginate-1.lua")),
            (
                "getCountsPerPriority",
                2,
                include_str!("commands/getCountsPerPriority-2.lua"),
            ),
            (
                "getDependencyCounts",
                4,
                include_str!("commands/getDependencyCounts-4.lua"),
            ),
            ("getMetrics", 2, include_str!("commands/getMetrics-2.lua")),
            (
                "reprocessJob",
                8,
                include_str!("commands/reprocessJob-8.lua"),
            ),
            (
                "removeChildDependency",
                1,
                include_str!("commands/removeChildDependency-1.lua"),
            ),
            (
                "removeUnprocessedChildren",
                2,
                include_str!("commands/removeUnprocessedChildren-2.lua"),
            ),
            (
                "removeOrphanedJobs",
                1,
                include_str!("commands/removeOrphanedJobs-1.lua"),
            ),
        ]
    }
}

impl Default for ScriptRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Compute SHA1 hash of a string (for EVALSHA).
fn compute_sha1(content: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(content.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sha1_computation() {
        let sha = compute_sha1("return 1");
        assert_eq!(sha.len(), 40);
    }

    async fn test_conn() -> MultiplexedConnection {
        let url =
            std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
        let client = redis::Client::open(url).expect("valid REDIS_URL");
        client
            .get_multiplexed_async_connection()
            .await
            .expect("redis connection")
    }

    async fn script_exists(conn: &mut MultiplexedConnection, shas: &[&str]) -> Vec<bool> {
        let mut cmd = redis::cmd("SCRIPT");
        cmd.arg("EXISTS");
        for sha in shas {
            cmd.arg(*sha);
        }
        cmd.query_async(conn).await.expect("SCRIPT EXISTS")
    }

    #[tokio::test]
    async fn test_execute_falls_back_to_eval_and_caches_script() {
        let mut conn = test_conn().await;
        redis::cmd("SCRIPT")
            .arg("FLUSH")
            .arg("SYNC")
            .query_async::<()>(&mut conn)
            .await
            .expect("SCRIPT FLUSH");

        let script = LuaScript::new("test", 0, "return 1");
        let keys: Vec<String> = Vec::new();
        let args: Vec<String> = Vec::new();

        let result = script
            .execute(&mut conn, &keys, &args)
            .await
            .expect("execute");

        assert_eq!(result, redis::Value::Int(1));
        assert_eq!(
            script_exists(&mut conn, &[script.sha.as_str()]).await,
            vec![true]
        );
    }

    #[tokio::test]
    async fn test_ensure_loaded_loads_only_requested_scripts() {
        let mut conn = test_conn().await;
        redis::cmd("SCRIPT")
            .arg("FLUSH")
            .arg("SYNC")
            .query_async::<()>(&mut conn)
            .await
            .expect("SCRIPT FLUSH");

        let registry = ScriptRegistry::new();
        registry
            .ensure_loaded(&mut conn, &["addStandardJob", "addStandardJob"])
            .await
            .expect("ensure_loaded");

        let add_standard = registry.get("addStandardJob").expect("addStandardJob");
        let add_parent = registry.get("addParentJob").expect("addParentJob");
        let existing = script_exists(
            &mut conn,
            &[add_standard.sha.as_str(), add_parent.sha.as_str()],
        )
        .await;

        assert_eq!(existing, vec![true, false]);
    }
}
