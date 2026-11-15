import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import {
  BanditSimulateDto,
  LiveContextQueryDto,
  MarketPricingDto,
  OptimizeAllocationDto,
  OptimizeLiveAllocationDto,
  PortfolioOptimizeDto,
  RevenueQuoteDto,
  ScenarioRunDto,
} from './dto/revenue.dto';
import { RevenueService } from './revenue.service';

@Controller('revenue')
export class RevenueController {
  constructor(private readonly revenueService: RevenueService) {}

  @Get('live-context')
  async getLiveContext(@Query() query: LiveContextQueryDto) {
    return { data: await this.revenueService.getLiveContext(query) };
  }

  @Post('market-decision')
  @HttpCode(200)
  async marketDecision(@Body() dto: MarketPricingDto) {
    return { data: await this.revenueService.marketDecision(dto) };
  }

  @Get('scenarios')
  async getScenarios() {
    return { data: await this.revenueService.getScenarios() };
  }

  @Post('decision')
  @HttpCode(200)
  async evaluateQuote(@Body() dto: RevenueQuoteDto) {
    return { data: await this.revenueService.evaluateQuote(dto) };
  }

  @Post('optimize-allocation')
  @HttpCode(200)
  async optimizeAllocation(@Body() dto: OptimizeAllocationDto) {
    return { data: await this.revenueService.optimizeAllocation(dto) };
  }

  @Post('optimize-allocation-live')
  @HttpCode(200)
  async optimizeAllocationLive(@Body() dto: OptimizeLiveAllocationDto) {
    return { data: await this.revenueService.optimizeAllocationLive(dto) };
  }

  @Post('portfolio-optimize')
  @HttpCode(200)
  async optimizePortfolio(@Body() dto: PortfolioOptimizeDto) {
    return { data: await this.revenueService.optimizePortfolio(dto) };
  }

  @Post('bandit-simulate')
  @HttpCode(200)
  async simulateBanditBenchmark(@Body() dto: BanditSimulateDto) {
    return { data: await this.revenueService.simulateBanditBenchmark(dto) };
  }

  @Get('sandbox/scenarios')
  async getSandboxScenarios() {
    return { data: await this.revenueService.getSandboxScenarios() };
  }

  @Post('sandbox/run')
  @HttpCode(200)
  async runSandboxScenario(@Body() dto: ScenarioRunDto) {
    return { data: await this.revenueService.runSandboxScenario(dto) };
  }
}
