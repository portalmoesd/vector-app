function asTrimmedString(value, field, options = {}) {
  if (typeof value !== 'string') {
    return { error: `${field} must be text` };
  }
  const trimmed = value.trim();
  if (options.required && !trimmed) {
    return { error: `${field} is required` };
  }
  if (options.max && trimmed.length > options.max) {
    return { error: `${field} must be ${options.max} characters or fewer` };
  }
  return { value: trimmed };
}

function asOptionalTrimmedString(value, field, options = {}) {
  if (value === undefined || value === null || value === '') return { value: null };
  return asTrimmedString(value, field, options);
}

function asPositiveInt(value, field, options = {}) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    if (options.required === false && (value === undefined || value === null || value === '')) {
      return { value: null };
    }
    return { error: `${field} must be a positive integer` };
  }
  return { value: number };
}

function asPositiveIntArray(value, field, options = {}) {
  if (value === undefined || value === null) {
    return options.required ? { error: `${field} is required` } : { value: [] };
  }
  if (!Array.isArray(value)) return { error: `${field} must be an array` };
  const values = [];
  for (const item of value) {
    const parsed = asPositiveInt(item, field);
    if (parsed.error) return parsed;
    values.push(parsed.value);
  }
  return { value: [...new Set(values)] };
}

function asEnum(value, field, allowed, options = {}) {
  if ((value === undefined || value === null || value === '') && options.default !== undefined) {
    return { value: options.default };
  }
  if (!allowed.includes(value)) {
    return { error: `${field} must be one of: ${allowed.join(', ')}` };
  }
  return { value };
}

function asBoolean(value, field, options = {}) {
  if (value === undefined || value === null || value === '') {
    return { value: !!options.default };
  }
  if (typeof value === 'boolean') return { value };
  if (value === 'true' || value === 'yes') return { value: true };
  if (value === 'false' || value === 'no') return { value: false };
  return { error: `${field} must be true or false` };
}

function asIsoDate(value, field, options = {}) {
  if (!value) return options.required ? { error: `${field} is required` } : { value: null };
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { error: `${field} must use YYYY-MM-DD format` };
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return { error: `${field} must be a valid date` };
  }
  return { value };
}

function asEmail(value, field, options = {}) {
  const text = asTrimmedString(value, field, options);
  if (text.error) return text;
  const normalized = text.value.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return { error: `${field} must be a valid email address` };
  }
  return { value: normalized };
}

function asUsername(value, field, options = {}) {
  const text = asTrimmedString(value, field, options);
  if (text.error) return text;
  const normalized = text.value.toLowerCase();
  if (!/^[a-z0-9._-]{3,100}$/.test(normalized)) {
    return { error: `${field} must be 3-100 characters using letters, numbers, dots, underscores, or hyphens` };
  }
  return { value: normalized };
}

function validationError(res, error) {
  return res.status(400).json({ error });
}

module.exports = {
  asTrimmedString,
  asOptionalTrimmedString,
  asPositiveInt,
  asPositiveIntArray,
  asEnum,
  asBoolean,
  asIsoDate,
  asEmail,
  asUsername,
  validationError,
};
