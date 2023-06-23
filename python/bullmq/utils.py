import semver
import traceback

def isRedisVersionLowerThan(current_version, minimum_version):
    return semver.compare(current_version, minimum_version) == -1

def extract_result(job_task):
    try:
        return job_task.result()
    except Exception as e:
        if not str(e).startswith('Connection closed by server'):
            # lets use a simple-but-effective error handling:
            # print error message and ignore the job
            print("ERROR:", e)
            traceback.print_exc()