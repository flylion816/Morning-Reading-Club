const DAY_MS = 24 * 60 * 60 * 1000;
const SHANGHAI_TIMEZONE = "Asia/Shanghai";
const SHANGHAI_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  timeZone: SHANGHAI_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  timeZone: SHANGHAI_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function pad(value) {
  return String(value).padStart(2, "0");
}

function normalizeDate(date) {
  if (!date) {
    return null;
  }

  const normalized = date instanceof Date ? date : new Date(date);
  return Number.isNaN(normalized.getTime()) ? null : normalized;
}

function toDateTimeParts(date = new Date()) {
  const normalized = normalizeDate(date);
  if (!normalized) {
    return {};
  }

  return SHANGHAI_DATE_TIME_FORMATTER.formatToParts(normalized).reduce(
    (acc, part) => {
      if (part.type !== "literal") {
        acc[part.type] = part.value;
      }
      return acc;
    },
    {},
  );
}

function toDateParts(date = new Date()) {
  const normalized = normalizeDate(date);
  if (!normalized) {
    return {};
  }

  return SHANGHAI_DATE_FORMATTER.formatToParts(normalized).reduce(
    (acc, part) => {
      if (part.type !== "literal") {
        acc[part.type] = part.value;
      }
      return acc;
    },
    {},
  );
}

function getShanghaiDateKey(date = new Date()) {
  const { year, month, day } = toDateParts(date);
  if (!year || !month || !day) {
    return null;
  }

  return `${year}-${month}-${day}`;
}

function getShanghaiDateTime(dateKey, hour = 0, minute = 0, second = 0) {
  if (!dateKey) {
    return null;
  }

  return new Date(
    `${dateKey}T${pad(hour)}:${pad(minute)}:${pad(second)}+08:00`,
  );
}

function addShanghaiDays(dateKey, days = 0) {
  const base = getShanghaiDateTime(dateKey, 0, 0, 0);
  if (!base) {
    return null;
  }

  const next = new Date(base.getTime() + days * DAY_MS);
  return getShanghaiDateKey(next);
}

function diffShanghaiDays(startKey, endKey) {
  const start = getShanghaiDateTime(startKey, 0, 0, 0);
  const end = getShanghaiDateTime(endKey, 0, 0, 0);
  if (!start || !end) {
    return null;
  }

  return Math.floor((end.getTime() - start.getTime()) / DAY_MS);
}

function isDateKeyWithinRange(dateKey, startKey, endKey) {
  if (!dateKey || !startKey || !endKey) {
    return false;
  }

  return dateKey >= startKey && dateKey <= endKey;
}

function getPeriodDateKeys(period = {}) {
  return {
    startKey: getShanghaiDateKey(period.startDate),
    endKey: getShanghaiDateKey(period.endDate),
  };
}

function formatShanghaiDateTimeLabel(date = new Date()) {
  const { year, month, day, hour, minute } = toDateTimeParts(date);
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function buildNextDayStudyReminderPlan({
  period = null,
  now = new Date(),
} = {}) {
  if (!period) {
    return {
      status: "missing_period",
    };
  }

  const { startKey, endKey } = getPeriodDateKeys(period);
  if (!startKey || !endKey) {
    return {
      status: "missing_period_dates",
      period,
      startKey,
      endKey,
    };
  }

  const todayKey = getShanghaiDateKey(now);
  const sendDateKey = addShanghaiDays(todayKey, 1);
  const sendDate = getShanghaiDateTime(sendDateKey, 5, 55, 0);
  const dayIndex = diffShanghaiDays(startKey, sendDateKey);

  if (dayIndex === null) {
    return {
      status: "invalid_period_dates",
      period,
      startKey,
      endKey,
      sendDate,
      sendDateKey,
    };
  }

  if (!isDateKeyWithinRange(sendDateKey, startKey, endKey)) {
    return {
      status: "out_of_range",
      period,
      startKey,
      endKey,
      sendDate,
      sendDateKey,
      dayIndex,
    };
  }

  return {
    status: "ok",
    period,
    startKey,
    endKey,
    todayKey,
    sendDate,
    sendDateKey,
    dayIndex,
  };
}

function buildScheduledStudyReminderPlan({
  period = null,
  sendDate = null,
} = {}) {
  if (!period || !sendDate) {
    return {
      status: "missing_period",
    };
  }

  const { startKey, endKey } = getPeriodDateKeys(period);
  const sendDateKey = getShanghaiDateKey(sendDate);
  const dayIndex = diffShanghaiDays(startKey, sendDateKey);

  if (dayIndex === null) {
    return {
      status: "invalid_period_dates",
      period,
      startKey,
      endKey,
      sendDate,
      sendDateKey,
    };
  }

  if (!isDateKeyWithinRange(sendDateKey, startKey, endKey)) {
    return {
      status: "out_of_range",
      period,
      startKey,
      endKey,
      sendDate,
      sendDateKey,
      dayIndex,
    };
  }

  return {
    status: "ok",
    period,
    startKey,
    endKey,
    sendDate,
    sendDateKey,
    dayIndex,
  };
}

function normalizeGrantContext(context) {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return {};
  }

  const normalized = {};
  [
    "periodId",
    "sourceAction",
    "sourcePage",
    "sourceId",
    "sectionId",
    "courseId",
  ].forEach((key) => {
    if (
      context[key] !== undefined &&
      context[key] !== null &&
      context[key] !== ""
    ) {
      normalized[key] = String(context[key]);
    }
  });

  return {
    ...normalized,
    ...Object.keys(context).reduce((acc, key) => {
      if (!Object.prototype.hasOwnProperty.call(normalized, key)) {
        acc[key] = context[key];
      }
      return acc;
    }, {}),
  };
}

module.exports = {
  addShanghaiDays,
  buildNextDayStudyReminderPlan,
  buildScheduledStudyReminderPlan,
  diffShanghaiDays,
  formatShanghaiDateTimeLabel,
  getPeriodDateKeys,
  getShanghaiDateKey,
  getShanghaiDateTime,
  isDateKeyWithinRange,
  normalizeGrantContext,
};
