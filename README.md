# Baseline

A daily weight journal with a 14-day moving average and height-based BMI. Each dot on the chart represents a weigh-in. The green line shows the mean of the weights recorded on that calendar day and the preceding 13 days. The first entry produces an average immediately, and missing dates contribute no measurements.

## Run locally

With Node.js 20 or later, run the following command from the repository root.

```sh
npm start
```

Open [Baseline locally](http://127.0.0.1:4173/). The static app lives in `baseline/dist/` and runs without a build or dependency installation. Run `npm test` to check the calculations.

## Using the tracker

Save a weight in kilograms and a date in **Log a weigh-in**. The arrows beside the date move it back or forward one day and stop at today. Saving again on the same date updates that entry. Use **Profile** to enter a height in centimeters. Baseline calculates BMI from the latest recorded weight.

The initial view contains labeled sample data. Your first saved weight or height starts your own log. Personal entries and height stay in the browser that saved them. Clearing site data removes them. The **Weight log** shows every entry and lets you edit or delete individual weigh-ins.
