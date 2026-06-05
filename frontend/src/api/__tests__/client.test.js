import { describe, it, expect } from 'vitest'
import { parse422 } from '../client'

describe('parse422', () => {
  it('returns joined field messages for array detail', () => {
    const err = {
      response: {
        data: {
          detail: [
            { loc: ['body', 'name'], msg: 'field required' },
            { loc: ['body', 'email'], msg: 'invalid format' },
          ],
        },
      },
    }
    expect(parse422(err)).toBe('name: field required; email: invalid format')
  })

  it('filters "body" from loc path', () => {
    const err = {
      response: {
        data: {
          detail: [
            { loc: ['body', 'address', 'zip'], msg: 'too short' },
          ],
        },
      },
    }
    expect(parse422(err)).toBe('address.zip: too short')
  })

  it('returns message only when loc has just "body"', () => {
    const err = {
      response: {
        data: {
          detail: [
            { loc: ['body'], msg: 'invalid payload' },
          ],
        },
      },
    }
    expect(parse422(err)).toBe('invalid payload')
  })

  it('returns message only when loc is empty', () => {
    const err = {
      response: {
        data: {
          detail: [
            { loc: [], msg: 'general error' },
          ],
        },
      },
    }
    expect(parse422(err)).toBe('general error')
  })

  it('handles missing loc gracefully', () => {
    const err = {
      response: {
        data: {
          detail: [
            { msg: 'no loc provided' },
          ],
        },
      },
    }
    expect(parse422(err)).toBe('no loc provided')
  })

  it('returns string detail directly', () => {
    const err = {
      response: {
        data: {
          detail: 'A simple string error',
        },
      },
    }
    expect(parse422(err)).toBe('A simple string error')
  })

  it('falls back to response.data.message when detail is not string or array', () => {
    const err = {
      response: {
        data: {
          detail: { some: 'object' },
          message: 'Fallback message',
        },
      },
    }
    expect(parse422(err)).toBe('Fallback message')
  })

  it('falls back to err.message when no detail or message', () => {
    const err = {
      response: {
        data: {},
      },
      message: 'Network Error',
    }
    expect(parse422(err)).toBe('Network Error')
  })

  it('returns "Validation error" as last resort', () => {
    const err = {
      response: {
        data: {},
      },
    }
    expect(parse422(err)).toBe('Validation error')
  })

  it('handles completely missing response', () => {
    const err = { message: 'Request failed' }
    expect(parse422(err)).toBe('Request failed')
  })

  it('handles multiple fields joined with semicolons', () => {
    const err = {
      response: {
        data: {
          detail: [
            { loc: ['body', 'title'], msg: 'required' },
            { loc: ['body', 'priority'], msg: 'invalid value' },
            { loc: ['body', 'status'], msg: 'not allowed' },
          ],
        },
      },
    }
    expect(parse422(err)).toBe('title: required; priority: invalid value; status: not allowed')
  })
})
