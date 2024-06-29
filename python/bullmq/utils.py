import semver
import traceback

def isRedisVersionLowerThan(current_version, minimum_version):
    return semver.VersionInfo.parse(current_version).compare(minimum_version) == -1

def extract_result(job_task, emit_callback):
    try:
        return job_task.result()
    except Exception as e:
        if not str(e).startswith('Connection closed by server'):
            # lets use a simple-but-effective error handling:
            # ignore the job
            traceback.print_exc()
            emit_callback("error", e)

def get_parent_key(opts: dict):
    if opts:
        return f"{opts.get('queue')}:{opts.get('id')}"
