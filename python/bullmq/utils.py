import semver

def isRedisVersionLowerThan(current_version, minimum_version):
    return semver.compare(current_version, minimum_version) == -1
