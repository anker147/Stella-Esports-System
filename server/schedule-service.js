const BEIJING_TIME_ZONE = 'Asia/Shanghai';

function beijingDate(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BEIJING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function beijingTimestamp(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BEIJING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}-${get('hour')}-${get('minute')}-${get('second')}`;
}

function selectSchedulePresentation(schedules, isMatchComplete, value = Date.now()) {
  const grouped = new Map();
  for (const schedule of schedules) {
    const image = schedule.event.scheduleImage;
    if (!image) continue;
    const group = grouped.get(schedule.event.date) || {
      date: schedule.event.date,
      image,
      tableImage: schedule.event.scheduleTableImage || null,
      matches: []
    };
    group.matches.push(...schedule.matches);
    grouped.set(schedule.event.date, group);
  }
  const dates = [...grouped.keys()].sort();
  if (!dates.length) return null;

  const today = beijingDate(value);
  let index = dates.findIndex(date => date >= today);
  if (index < 0) index = dates.length - 1;
  const current = grouped.get(dates[index]);
  const isToday = current.date === today;
  const complete = isToday && current.matches.length > 0 && current.matches.every(match => isMatchComplete(match.id));
  const selected = complete && index < dates.length - 1 ? grouped.get(dates[index + 1]) : current;
  return {
    date: selected.date,
    image: selected.image,
    tableImage: selected.tableImage,
    today,
    advanced: selected !== current,
    completedToday: complete
  };
}

module.exports = {
  BEIJING_TIME_ZONE,
  beijingDate,
  beijingTimestamp,
  selectSchedulePresentation
};
