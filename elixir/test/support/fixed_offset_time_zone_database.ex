defmodule BullMQ.FixedOffsetTimeZoneDatabase do
  @moduledoc false
  # Minimal time zone database for tests. It only knows "Etc/GMT-2", a real
  # zone with a constant UTC+2 offset and no daylight saving time.
  @behaviour Calendar.TimeZoneDatabase

  @period %{utc_offset: 7_200, std_offset: 0, zone_abbr: "+02"}

  @impl true
  def time_zone_period_from_utc_iso_days(_iso_days, "Etc/GMT-2"), do: {:ok, @period}
  def time_zone_period_from_utc_iso_days(_iso_days, _zone), do: {:error, :time_zone_not_found}

  @impl true
  def time_zone_periods_from_wall_datetime(_naive, "Etc/GMT-2"), do: {:ok, @period}
  def time_zone_periods_from_wall_datetime(_naive, _zone), do: {:error, :time_zone_not_found}
end
