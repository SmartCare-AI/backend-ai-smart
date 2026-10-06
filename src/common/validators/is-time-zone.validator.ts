import { registerDecorator, ValidationOptions } from 'class-validator';
import { isValidTimeZone } from '../utils/timezone.util';

/** Accepts IANA time-zone names such as "Africa/Cairo". */
export function IsTimeZone(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isTimeZone',
      target: target.constructor,
      propertyName: propertyName as string,
      options: {
        message: '$property must be an IANA time zone, e.g. "Africa/Cairo"',
        ...options,
      },
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && isValidTimeZone(value),
      },
    });
  };
}
