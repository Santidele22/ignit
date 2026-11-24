import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

/** The only two decisions an admin can submit. */
export const REVIEW_DECISIONS = ['approved', 'rejected'] as const;

export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/**
 * Body of `POST /admin/books/:id/review`. Publishing is intentionally a
 * separate, explicit flag: approving a PDF does not put it on the landing
 * unless the admin also sends `publish: true`.
 */
export class ReviewBookDto {
  @ApiProperty({
    enum: REVIEW_DECISIONS,
    enumName: 'ReviewDecision',
    example: 'approved',
  })
  @IsIn([...REVIEW_DECISIONS])
  decision: ReviewDecision;

  @ApiPropertyOptional({
    type: String,
    description: 'Optional admin note explaining the decision (required in practice for a rejection)',
  })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({
    type: Boolean,
    default: false,
    description: 'Publish the book as part of an approval (ignored on rejection)',
  })
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}
