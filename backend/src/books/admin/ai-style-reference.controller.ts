import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '@thallesp/nestjs-better-auth';
import { ApiAdminAuth } from '../../common/swagger/api-decorators.js';
import { EDITORIAL_STYLE_REFERENCE } from '../ai/editorial-reference.js';

/**
 * Serves the editorial style reference the analysis LLM applies (S6): the
 * same single source `EDITORIAL_STYLE_REFERENCE` that builds the system
 * prompt, so /admin can never drift away from what the model actually uses.
 */
@ApiTags('Admin · AI')
@Controller('admin/ai')
@Roles(['admin'])
@ApiAdminAuth()
export class AiStyleReferenceController {
  @Get('style-reference')
  @ApiOperation({
    summary: 'Editorial style reference of the analysis LLM (admin only)',
    description:
      'The structured design/quality reference derived from the same source that builds the analysis system prompt: role, security boundary, the 1–5 editorial quality rubric, what the model receives and what it deliberately does not judge.',
  })
  @ApiOkResponse({ description: 'EditorialStyleReference JSON' })
  show() {
    return EDITORIAL_STYLE_REFERENCE;
  }
}
