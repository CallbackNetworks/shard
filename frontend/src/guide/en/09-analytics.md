# Analytics

Six reports, all from work you have already recorded. Nothing here needs extra
data entry.

![Analytics](/guide/08-analytics.png)

## Choosing what to measure

The boxes at the top: leave the first on *All projects* for the whole picture, or
choose one project to unlock the reports that need cycles. The last box sets how far
back the trend lines look — a week, a month, or three months.

## The headline numbers

Total, done, in progress, and overdue. Plus the most active project this week, which
is often not the one you think.

## The reports

**Activity heatmap** — a square per day, darker when more happened. It shows the
shape of your weeks: which days you actually work, and the gaps.

**Cycle burndown** — needs a project with a cycle selected. Remaining work day by
day, against a straight line down to zero. The gap between the two lines is the
answer to "are we going to make it?", and the page states it in words rather than
leaving you to eyeball two lines.

**Velocity** — how much you finished in each past cycle. After three or four cycles
this is a better basis for planning the next one than any estimate, because it is
made of what actually happened.

**Status trend** — how the counts moved over the window you chose. A rising to-do
line with a flat done line is the shape worth catching early.

**Estimation calibration** — compares the time you estimated against the time things
took. It reports an overall ratio and how many landed within 20%. Most people are
consistently wrong by a stable factor, and knowing yours is more useful than trying
to estimate better.

## One report that is not on this page

**Critical path** — the chain of dependent tasks that decides the earliest a project
could possibly finish — is available through the API and to AI agents rather than as
a chart here. Shortening anything *not* on that chain does not move the date, which
is what makes it worth asking for.

## Getting the numbers out

Every section has a **CSV** button. The download opens in any spreadsheet, so a
report you want in a different shape is a download away rather than a feature
request.

## A note on what the numbers mean

"Overdue" means the same thing here as everywhere else in the app: past its due
date, and not done and not failed.

The counts also include **task-like custom types**. If you have made your own item
type and given it the task role, it is counted here exactly like a built-in task.
