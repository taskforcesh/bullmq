defmodule BullMQ.Utils do
  @moduledoc """
  General utility functions for BullMQ.
  """

  @doc """
  Gets an option value from a map or keyword list by checking candidate keys in order.

  Preserves `false` values (only `nil` falls back to subsequent keys or default).

  ## Examples

      iex> BullMQ.Utils.get_opt(%{"pattern" => "* * *"}, ["pattern", :pattern])
      "* * *"

      iex> BullMQ.Utils.get_opt(%{pattern: "* * *"}, ["pattern", :pattern])
      "* * *"

      iex> BullMQ.Utils.get_opt(%{}, ["pattern", :pattern], "default")
      "default"

      iex> BullMQ.Utils.get_opt(%{remove_on_complete: false}, [:remove_on_complete], true)
      false

  """
  @spec get_opt(map() | keyword() | nil, list() | any(), any()) :: any()
  def get_opt(opts, keys, default \\ nil)

  def get_opt(nil, _keys, default), do: default

  def get_opt(opts, keys, default) when is_list(keys) do
    Enum.reduce_while(keys, default, fn key, acc ->
      case fetch_value(opts, key) do
        {:ok, value} when not is_nil(value) -> {:halt, value}
        _ -> {:cont, acc}
      end
    end)
  end

  def get_opt(opts, key, default) do
    get_opt(opts, [key], default)
  end

  @doc """
  Gets an option value by checking two candidate keys in order, falling back to `default`.

  ## Examples

      iex> BullMQ.Utils.get_opt(%{"every" => 1000}, "every", :every, 5000)
      1000

      iex> BullMQ.Utils.get_opt(%{}, "every", :every, 5000)
      5000

  """
  @spec get_opt(map() | keyword() | nil, any(), any(), any()) :: any()
  def get_opt(opts, key1, key2, default) do
    get_opt(opts, [key1, key2], default)
  end

  @doc """
  Gets an option value by checking two keys in order (e.g. string key and atom key),
  with an optional `default` value (defaults to `nil`).

  ## Examples

      iex> BullMQ.Utils.get_opts_value(%{"pattern" => "* * *"}, "pattern", :pattern)
      "* * *"

      iex> BullMQ.Utils.get_opts_value(%{pattern: "* * *"}, "pattern", :pattern)
      "* * *"

      iex> BullMQ.Utils.get_opts_value(%{}, "pattern", :pattern, "default")
      "default"

  """
  @spec get_opts_value(map() | keyword() | nil, any(), any(), any()) :: any()
  def get_opts_value(opts, key1, key2, default \\ nil) do
    get_opt(opts, [key1, key2], default)
  end

  defp fetch_value(opts, key) when is_map(opts) do
    case Map.fetch(opts, key) do
      {:ok, val} -> {:ok, val}
      :error -> :error
    end
  end

  defp fetch_value(opts, key) when is_list(opts) and is_atom(key) do
    case Keyword.fetch(opts, key) do
      {:ok, val} -> {:ok, val}
      :error -> :error
    end
  end

  defp fetch_value(opts, key) when is_list(opts) do
    case List.keyfind(opts, key, 0) do
      {^key, val} -> {:ok, val}
      nil -> :error
    end
  end

  defp fetch_value(_opts, _key), do: :error

  @doc """
  Parses a value into an integer, falling back to `default` (defaults to 0).

  Handles integers, floats (via rounding), and numeric strings.

  ## Examples

      iex> BullMQ.Utils.parse_int("42")
      42

      iex> BullMQ.Utils.parse_int(nil, 10)
      10

  """
  @spec parse_int(any(), any()) :: integer() | any()
  def parse_int(val, default \\ 0)
  def parse_int(nil, default), do: default
  def parse_int(n, _default) when is_integer(n), do: n
  def parse_int(f, _default) when is_float(f), do: round(f)

  def parse_int(s, default) when is_binary(s) do
    case Integer.parse(s) do
      {int, _} -> int
      :error -> default
    end
  end

  def parse_int(_other, default), do: default

  @doc """
  Parses a value into an integer or returns `nil` if invalid, nil, or empty.

  ## Examples

      iex> BullMQ.Utils.parse_int_or_nil("42")
      42

      iex> BullMQ.Utils.parse_int_or_nil(nil)
      nil

      iex> BullMQ.Utils.parse_int_or_nil("")
      nil

  """
  @spec parse_int_or_nil(any()) :: integer() | nil
  def parse_int_or_nil(val) do
    parse_int(val, nil)
  end

  @doc """
  Converts a flat key-value list `[k1, v1, k2, v2, ...]` (e.g. from Redis HGETALL) into a map.

  If an odd number of elements is provided, the trailing key is paired with `nil`.
  If already a map, it returns the map as-is.
  If `nil` or other non-list, returns `%{}`.

  ## Examples

      iex> BullMQ.Utils.parse_hash_data(["k1", "v1", "k2", "v2"])
      %{"k1" => "v1", "k2" => "v2"}

  """
  @spec parse_hash_data(list() | map() | any()) :: map()
  def parse_hash_data(list) when is_list(list) do
    list
    |> Enum.chunk_every(2)
    |> Enum.into(%{}, fn
      [k, v] -> {k, v}
      [k] -> {k, nil}
    end)
  end

  def parse_hash_data(map) when is_map(map), do: map
  def parse_hash_data(_), do: %{}
end

