export class LoginError extends Error {
  constructor(m: string) { super(m); this.name = 'LoginError'; }
}

export class MovieNotFound extends Error {
  constructor(m: string) { super(m); this.name = 'MovieNotFound'; }
}

export class ShowtimeNotFound extends Error {
  constructor(m: string) { super(m); this.name = 'ShowtimeNotFound'; }
}

export class NoSeatsAvailable extends Error {
  constructor(m: string) { super(m); this.name = 'NoSeatsAvailable'; }
}

export class BookingFailed extends Error {
  constructor(m: string) { super(m); this.name = 'BookingFailed'; }
}
