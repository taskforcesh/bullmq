use crate::error::Error;

pub(crate) type PaginateReply = (String, i64, Vec<redis::Value>, u64, Vec<redis::Value>);

/// Parse paginate reply `[cursor, offset, items, total, jobs]`.
pub(crate) fn parse_paginate_reply(value: &redis::Value) -> Result<PaginateReply, Error> {
    let arr = match value {
        redis::Value::Array(items) => items,
        _ => {
            return Err(Error::MsgPack(
                "unexpected paginate reply: not an array".to_string(),
            ))
        }
    };

    let cursor = arr
        .first()
        .and_then(value_to_string)
        .unwrap_or_else(|| "0".to_string());
    let offset = arr.get(1).and_then(value_as_i64).unwrap_or(0);
    let items = match arr.get(2) {
        Some(redis::Value::Array(items)) => items.clone(),
        _ => Vec::new(),
    };
    let total = arr.get(3).and_then(value_as_i64).unwrap_or(0).max(0) as u64;
    let jobs = match arr.get(4) {
        Some(redis::Value::Array(jobs)) => jobs.clone(),
        _ => Vec::new(),
    };

    Ok((cursor, offset, items, total, jobs))
}

/// Extract the member key from a paginate item.
///
/// For sets this is the member itself.
/// For hashes this is the first element of `[field, value]`.
pub(crate) fn paginate_item_key(item: &redis::Value) -> Option<String> {
    match item {
        redis::Value::Array(pair) => pair.first().and_then(value_to_string),
        other => value_to_string(other),
    }
}

pub(crate) fn value_to_string(value: &redis::Value) -> Option<String> {
    match value {
        redis::Value::BulkString(b) => Some(String::from_utf8_lossy(b).to_string()),
        redis::Value::SimpleString(s) => Some(s.clone()),
        redis::Value::Int(n) => Some(n.to_string()),
        _ => None,
    }
}

pub(crate) fn value_as_i64(value: &redis::Value) -> Option<i64> {
    match value {
        redis::Value::Int(n) => Some(*n),
        redis::Value::BulkString(b) => String::from_utf8_lossy(b).parse().ok(),
        redis::Value::SimpleString(s) => s.parse().ok(),
        _ => None,
    }
}
