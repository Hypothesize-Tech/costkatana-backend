import { ForbiddenException } from '@nestjs/common';
import { ReferenceImageS3Service } from '../reference-image-s3.service';

function makeService(): ReferenceImageS3Service {
  // ConfigService is unused by `assertOwnership`; pass a stub.
  return new ReferenceImageS3Service({} as never);
}

describe('ReferenceImageS3Service.assertOwnership', () => {
  const userA = '507f1f77bcf86cd799439011';
  const userB = '507f1f77bcf86cd799439012';

  it('accepts a key owned by the caller', () => {
    const svc = makeService();
    expect(() =>
      svc.assertOwnership(
        `reference-images/${userA}/tmpl-1/1700000000-photo.png`,
        userA,
      ),
    ).not.toThrow();
  });

  it("rejects a key owned by a different user", () => {
    const svc = makeService();
    expect(() =>
      svc.assertOwnership(
        `reference-images/${userB}/tmpl-1/1700000000-photo.png`,
        userA,
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects path-traversal style keys', () => {
    const svc = makeService();
    expect(() =>
      svc.assertOwnership(
        `reference-images/${userA}/../${userB}/tmpl/photo.png`,
        userA,
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects keys with double-slash sequences (URL parser tricks)', () => {
    const svc = makeService();
    expect(() =>
      svc.assertOwnership(
        `reference-images//${userA}/tmpl/photo.png`,
        userA,
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects keys missing the reference-images/ prefix', () => {
    const svc = makeService();
    expect(() =>
      svc.assertOwnership(`other-bucket-prefix/${userA}/foo.png`, userA),
    ).toThrow(ForbiddenException);
  });

  it('rejects empty key or empty userId', () => {
    const svc = makeService();
    expect(() => svc.assertOwnership('', userA)).toThrow(ForbiddenException);
    expect(() =>
      svc.assertOwnership(`reference-images/${userA}/foo.png`, ''),
    ).toThrow(ForbiddenException);
  });

  it('rejects partial userId match (substring attack)', () => {
    // If the check were `s3Key.includes(userId)`, a key like
    // reference-images/<userA-prefix-of-attacker>/... could pass.
    // The startsWith-with-trailing-slash form blocks this.
    const partial = userA.substring(0, userA.length - 2); // shorter than full id
    const svc = makeService();
    expect(() =>
      svc.assertOwnership(
        `reference-images/${partial}/tmpl/photo.png`,
        userA,
      ),
    ).toThrow(ForbiddenException);
  });
});
