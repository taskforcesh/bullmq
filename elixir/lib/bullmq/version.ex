defmodule BullMQ.Version do
  @moduledoc """
  BullMQ version information.

  This module contains the BullMQ version that corresponds to the Lua scripts
  being used. This version is stored in Redis to indicate queue capabilities
  and is used by frontends (like Bull Board) to match features.

  **Important:** This version tracks the Lua script compatibility with the
  Node.js BullMQ library, NOT the Elixir package version. The Elixir package
  version is defined in `mix.exs` and can evolve independently on Hex.pm.

  ## How it works

  When a Queue or Worker interacts with Redis, the BullMQ version is stored
  in the queue's meta hash. This allows:

  - Frontends to know which features are available
  - Different clients (Node.js, Python, Elixir) to interoperate
  - Backward compatibility checks

  ## Version Format

  The version stored in Redis follows the format: `bullmq:<version>`

  For example: `bullmq:5.65.1`
  """

  # The BullMQ version corresponding to the Lua scripts.
  # This should match the Node.js BullMQ version that the Lua scripts
  # in `priv/scripts/` are sourced from.
  @bullmq_version "5.65.1"

  @doc """
  Returns the BullMQ version string.

  ## Examples

      iex> BullMQ.Version.version()
      "5.65.1"
  """
  @spec version() :: String.t()
  def version, do: @bullmq_version

  @doc """
  Returns the full version string as stored in Redis.

  ## Examples

      iex> BullMQ.Version.full_version()
      "bullmq:5.65.1"
  """
  @spec full_version() :: String.t()
  def full_version, do: "bullmq:#{@bullmq_version}"

  @doc """
  The library name used in the version prefix.
  """
  @spec lib_name() :: String.t()
  def lib_name, do: "bullmq"
end
