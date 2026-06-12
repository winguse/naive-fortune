const marketData = {
  "ETF1": [{ date: "2023-01-01", close: 100 }, { date: "2023-01-03", close: 105 }],
  "ETF2": [{ date: "2023-01-02", close: 200 }, { date: "2023-01-03", close: 210 }]
};

const seriesKeys = Object.keys(marketData);

const allDatesSet = new Set();
seriesKeys.forEach(code => {
  marketData[code].forEach(c => allDatesSet.add(c.date));
});
const allDates = Array.from(allDatesSet).sort();

console.log("allDates", allDates);

const interpolatedData = {};

seriesKeys.forEach(code => {
  interpolatedData[code] = {};
  const data = marketData[code];
  let ptr = 0;

  for (let i = 0; i < allDates.length; i++) {
    const d = allDates[i];
    const tsD = new Date(d).getTime();

    // Find closest before and after
    let prev = null;
    let next = null;

    for (let j = 0; j < data.length; j++) {
      if (data[j].date === d) {
        prev = data[j];
        next = data[j];
        break;
      }
      if (new Date(data[j].date).getTime() < tsD) {
        prev = data[j];
      }
      if (new Date(data[j].date).getTime() > tsD && next === null) {
        next = data[j];
        break;
      }
    }

    if (prev && next && prev.date === next.date) {
      interpolatedData[code][d] = prev.close;
    } else if (prev && next) {
      const tsPrev = new Date(prev.date).getTime();
      const tsNext = new Date(next.date).getTime();
      const ratio = (tsD - tsPrev) / (tsNext - tsPrev);
      interpolatedData[code][d] = prev.close + ratio * (next.close - prev.close);
    } else if (prev && !next) {
      interpolatedData[code][d] = prev.close; // carry forward
    } else if (!prev && next) {
      // not started yet
      interpolatedData[code][d] = null;
    }
  }
});

console.log("interpolated", interpolatedData);
