import json
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


def decodeByteString(raw: bytes) -> str:
    """
    This function decode byte string

    :param raw: byte string (bytes)
    :return:
    """
    return raw.decode("utf-8") if isinstance(raw, bytes) else raw


def decodeByteJSON(rawData: dict) -> dict:
    """
    This function decode a dict where keys or values maybe are byte strings and
    convert them into their appropriate Python types.

    This function performs the following operations:
    1. Decodes byte strings to UTF-8 text strings.
    2. Attempts to parse JSON strings into Python dictionaries or lists.
    3. Leaves non-JSON strings as they are.

    :param rawData: A dictionary where keys and values are byte strings
                    (i.e., instances of `bytes`). Example format:
                    {b'key': b'value', b'json_key': b'{"nested_key": "nested_value"}'}

    :return: A dictionary with text string keys and values. JSON strings
             are parsed into Python objects (dictionaries or lists), while
             other string values remain unchanged. Example output:
             {'key': 'value', 'json_key': {'nested_key': 'nested_value'}}

    :rtype: dict

    :raises TypeError: If `rawData` is not of type `dict` or if the keys or values
                       are not of type `bytes`.
    """
    decodedData = {}

    for key, value in rawData.items():
        key, value = decodeByteString(key), decodeByteString(value)
        try:
            decodedData[key] = json.loads(value)
        except (json.JSONDecodeError, TypeError):
            decodedData[key] = value
    return decodedData
