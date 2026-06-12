1.  **Extract All Dates & Handle Missing Data**:
    *   Iterate over all `marketData` to collect a unique, sorted array of all date strings (or timestamps).
    *   For each security, map its data to these dates.
    *   If a security is missing data on a date, interpolate its price using the previous available price and the next available price. If there's no previous price (it hasn't started yet), leave it as null. (Linear interpolation based on time differences).

2.  **State for Zoom Range**:
    *   We need a state `zoomRange` containing `{ startValue: number, endValue: number }` (representing timestamps).
    *   Initialize it to the 50%-100% range of the all-dates array.

3.  **Data Normalization Function (Runs when `marketData` or `zoomRange` changes)**:
    *   Identify the `visibleDates` which are $\ge$ `zoomRange.startValue` and $\le$ `zoomRange.endValue`.
    *   If `visibleDates` is empty, just return unnormalized data or wait.
    *   Find the baseline for each security:
        *   Initialize `baselines = {}`
        *   Iterate through `visibleDates`:
            *   Calculate `avgNorm` of securities that *already have* a baseline on this date.
            *   For each security that has non-null data on this date but *no baseline yet*:
                *   If it's the very first visible date (or `avgNorm` is somehow undefined/0), its baseline is simply its absolute price on this date.
                *   Otherwise, its baseline = `absolutePrice / avgNorm`.
                *   Store this baseline.
    *   Generate the series data: for every date in the *entire dataset* (so panning works smoothly), calculate the normalized value = `absolutePrice / baseline`. (If baseline is not yet established because the date is before the security starts, it stays null).
    *   Each point in the series data will be an array: `[timestamp, normalizedValue, absolutePrice, baseline]`.
    *   *Wait*, the baseline is established based on the *first appearance in the visible window*. The `startAbsolutePrice` for the tooltip's `+- % since start` calculation should be the price at the security's first appearance *in the visible window*. That is exactly its baseline? No. If a security starts late, its baseline = `absolutePrice / avgNorm`. Its actual start absolute price in the window is `absolutePrice`. We need to store `startAbsolutePrice` separately for the tooltip.
    *   So: `startAbsolutePrices = {}`. When setting `baseline`, also set `startAbsolutePrices[code] = absolutePrice`.
    *   Point data: `[timestamp, normalizedValue, absolutePrice, startAbsolutePrice]`.

4.  **Echarts Tooltip Formatter**:
    *   Format the tooltip to show the absolute value and the percentage change: `((absolutePrice - startAbsolutePrice) / startAbsolutePrice) * 100`.
    *   Also format the x-axis properly (it's time).
    *   Display each series correctly.

5.  **Handling Echarts Events**:
    *   Use `onEvents={{ datazoom: handleDataZoom }}`.
    *   The `handleDataZoom` will read the event. Echarts `datazoom` event might provide `start` and `end` (percentages) or `startValue` / `endValue` (axis values). Wait, if there are multiple datazooms (inside and slider), the event payload differs. Usually `chartRef.current.getEchartsInstance().getOption().dataZoom[0]` has the current `startValue` and `endValue`.
    *   We can update the `zoomRange` state with these `startValue` and `endValue`.
    *   *Important*: Updating the React state will re-render and generate a new `chartOption`. We need to be careful that setting `dataZoom: [{ startValue: X, endValue: Y }]` in the new `chartOption` doesn't re-trigger `datazoom` events in an infinite loop, or reset the zoom unexpectedly. Actually, if we just calculate the data and pass it, and keep `dataZoom` uncontrolled (not setting `startValue`/`endValue` in the option, or setting them to exactly what we read), it should be fine. Echarts handles `replaceMerge` well.

6.  **Pre-commit Step**:
    *   Run tests and linter as required by the setup.
