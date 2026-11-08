-- CreateEnum
CREATE TYPE "Jurisdiction" AS ENUM ('ONTARIO', 'BRITISH_COLUMBIA', 'US_FEDERAL');

-- CreateEnum
CREATE TYPE "TrainingLevel" AS ENUM ('TRAINEE', 'CERTIFIED', 'TRAINER');

-- CreateEnum
CREATE TYPE "CertType" AS ENUM ('FOOD_HANDLER', 'BAKER', 'SUPERVISOR', 'FIRST_AID');

-- CreateEnum
CREATE TYPE "Daypart" AS ENUM ('OVERNIGHT', 'MORNING_RUSH', 'MIDDAY', 'AFTERNOON', 'EVENING_CLOSE');

-- CreateEnum
CREATE TYPE "TimeOffStatus" AS ENUM ('REQUESTED', 'APPROVED', 'DENIED');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('SCHEDULED', 'CALLED_OUT', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CallOutSource" AS ENUM ('SMS', 'MANAGER');

-- CreateEnum
CREATE TYPE "CallOutStatus" AS ENUM ('OPEN', 'PLANNED', 'OUTREACH', 'COVERED', 'UNFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OfferKind" AS ENUM ('CALL_IN', 'EXTEND');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('PENDING', 'SENT', 'CLARIFYING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReplyIntent" AS ENUM ('ACCEPT', 'DECLINE', 'CONDITIONAL', 'QUESTION', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "SmsProvider" AS ENUM ('SIM', 'TWILIO');

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
    "jurisdiction" "Jurisdiction" NOT NULL DEFAULT 'ONTARIO',
    "openTime" TIME(0) NOT NULL,
    "closeTime" TIME(0) NOT NULL,
    "managerName" TEXT NOT NULL,
    "managerPhone" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleConfig" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "weeklyOtHours" DECIMAL(4,1) NOT NULL,
    "dailyOtHours" DECIMAL(4,1),
    "minRestHours" DECIMAL(4,1) NOT NULL DEFAULT 11,
    "maxConsecutiveDays" INTEGER NOT NULL DEFAULT 6,
    "youthMaxSchoolDayHours" DECIMAL(3,1) NOT NULL DEFAULT 3,
    "youthMaxSchoolWeekHours" DECIMAL(4,1) NOT NULL DEFAULT 18,
    "youthLatestEnd" TIME(0) NOT NULL DEFAULT '19:00:00'::time,
    "offerTimeoutSec" INTEGER NOT NULL DEFAULT 600,
    "demoMode" BOOLEAN NOT NULL DEFAULT false,
    "smsProvider" "SmsProvider" NOT NULL DEFAULT 'SIM',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RuleConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Station" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortCode" VARCHAR(8) NOT NULL,
    "color" VARCHAR(7) NOT NULL,
    "priority" INTEGER NOT NULL,
    "requiredCert" "CertType",
    "minLevelDuringRush" "TrainingLevel" NOT NULL DEFAULT 'TRAINEE',
    "youthRestricted" BOOLEAN NOT NULL DEFAULT false,
    "isSupervisor" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Station_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Crew" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "birthdate" DATE NOT NULL,
    "isStudent" BOOLEAN NOT NULL DEFAULT false,
    "hourlyWage" DECIMAL(6,2) NOT NULL,
    "hireDate" DATE NOT NULL,
    "reliability" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "maxWeeklyHours" DECIMAL(4,1),
    "smsOptIn" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Crew_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrewStation" (
    "id" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "level" "TrainingLevel" NOT NULL,
    "trainedOn" DATE,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CrewStation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cert" (
    "id" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "type" "CertType" NOT NULL,
    "issuedAt" DATE NOT NULL,
    "expiresAt" DATE,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Cert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Availability" (
    "id" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "startTime" TIME(0) NOT NULL,
    "endTime" TIME(0) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolDay" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SchoolDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeOff" (
    "id" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "start" TIMESTAMPTZ(3) NOT NULL,
    "end" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT,
    "status" "TimeOffStatus" NOT NULL DEFAULT 'REQUESTED',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TimeOff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "start" TIMESTAMPTZ(3) NOT NULL,
    "end" TIMESTAMPTZ(3) NOT NULL,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "status" "ShiftStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StationAssignment" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "start" TIMESTAMPTZ(3) NOT NULL,
    "end" TIMESTAMPTZ(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StationAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverageRule" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "weekday" SMALLINT,
    "daypart" "Daypart" NOT NULL,
    "startTime" TIME(0) NOT NULL,
    "endTime" TIME(0) NOT NULL,
    "minCount" SMALLINT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CoverageRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallOut" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "source" "CallOutSource" NOT NULL,
    "rawText" TEXT,
    "reason" TEXT,
    "parseConfidence" DOUBLE PRECISION,
    "status" "CallOutStatus" NOT NULL DEFAULT 'OPEN',
    "approvedAt" TIMESTAMPTZ(3),
    "otApproved" BOOLEAN NOT NULL DEFAULT false,
    "coveredAt" TIMESTAMPTZ(3),
    "coveredById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CallOut_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryPlan" (
    "id" TEXT NOT NULL,
    "callOutId" TEXT NOT NULL,
    "shortfall" JSONB NOT NULL,
    "moves" JSONB NOT NULL,
    "remainingShortfall" JSONB NOT NULL,
    "candidates" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "llmProvider" TEXT,
    "llmModel" TEXT,
    "appliedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RecoveryPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "callOutId" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "kind" "OfferKind" NOT NULL,
    "start" TIMESTAMPTZ(3) NOT NULL,
    "end" TIMESTAMPTZ(3) NOT NULL,
    "rank" SMALLINT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "isOvertime" BOOLEAN NOT NULL DEFAULT false,
    "rationale" TEXT,
    "status" "OfferStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "respondedAt" TIMESTAMPTZ(3),
    "replyIntent" "ReplyIntent",
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "crewId" TEXT,
    "callOutId" TEXT,
    "offerId" TEXT,
    "direction" "MessageDirection" NOT NULL,
    "fromPhone" TEXT NOT NULL,
    "toPhone" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "provider" "SmsProvider" NOT NULL,
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "callOutId" TEXT,
    "type" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RuleConfig_storeId_key" ON "RuleConfig"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "Station_storeId_name_key" ON "Station"("storeId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Crew_phone_key" ON "Crew"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "CrewStation_crewId_stationId_key" ON "CrewStation"("crewId", "stationId");

-- CreateIndex
CREATE UNIQUE INDEX "Cert_crewId_type_key" ON "Cert"("crewId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolDay_storeId_date_key" ON "SchoolDay"("storeId", "date");

-- CreateIndex
CREATE INDEX "Shift_crewId_start_idx" ON "Shift"("crewId", "start");

-- CreateIndex
CREATE INDEX "Shift_start_idx" ON "Shift"("start");

-- CreateIndex
CREATE INDEX "StationAssignment_stationId_start_idx" ON "StationAssignment"("stationId", "start");

-- CreateIndex
CREATE UNIQUE INDEX "CoverageRule_stationId_weekday_daypart_key" ON "CoverageRule"("stationId", "weekday", "daypart");

-- CreateIndex
CREATE INDEX "CallOut_status_idx" ON "CallOut"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryPlan_callOutId_key" ON "RecoveryPlan"("callOutId");

-- CreateIndex
CREATE INDEX "Offer_status_expiresAt_idx" ON "Offer"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_callOutId_crewId_key" ON "Offer"("callOutId", "crewId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_providerMessageId_key" ON "Message"("providerMessageId");

-- CreateIndex
CREATE INDEX "Message_crewId_sentAt_idx" ON "Message"("crewId", "sentAt");

-- CreateIndex
CREATE INDEX "AuditEvent_callOutId_at_idx" ON "AuditEvent"("callOutId", "at");

-- AddForeignKey
ALTER TABLE "RuleConfig" ADD CONSTRAINT "RuleConfig_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Station" ADD CONSTRAINT "Station_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Crew" ADD CONSTRAINT "Crew_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewStation" ADD CONSTRAINT "CrewStation_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewStation" ADD CONSTRAINT "CrewStation_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cert" ADD CONSTRAINT "Cert_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Availability" ADD CONSTRAINT "Availability_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolDay" ADD CONSTRAINT "SchoolDay_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeOff" ADD CONSTRAINT "TimeOff_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StationAssignment" ADD CONSTRAINT "StationAssignment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StationAssignment" ADD CONSTRAINT "StationAssignment_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageRule" ADD CONSTRAINT "CoverageRule_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageRule" ADD CONSTRAINT "CoverageRule_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallOut" ADD CONSTRAINT "CallOut_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallOut" ADD CONSTRAINT "CallOut_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallOut" ADD CONSTRAINT "CallOut_coveredById_fkey" FOREIGN KEY ("coveredById") REFERENCES "Crew"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryPlan" ADD CONSTRAINT "RecoveryPlan_callOutId_fkey" FOREIGN KEY ("callOutId") REFERENCES "CallOut"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_callOutId_fkey" FOREIGN KEY ("callOutId") REFERENCES "CallOut"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_callOutId_fkey" FOREIGN KEY ("callOutId") REFERENCES "CallOut"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_callOutId_fkey" FOREIGN KEY ("callOutId") REFERENCES "CallOut"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Raw SQL: constraints Prisma's schema language can't express (see plan/models.md)
-- ---------------------------------------------------------------------------

-- One live offer per call-out: outreach goes strictly one candidate at a time.
CREATE UNIQUE INDEX "one_live_offer" ON "Offer"("callOutId") WHERE "status" IN ('SENT', 'CLARIFYING');

-- Time ranges must be non-empty.
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_end_after_start" CHECK ("end" > "start");
ALTER TABLE "StationAssignment" ADD CONSTRAINT "StationAssignment_end_after_start" CHECK ("end" > "start");
ALTER TABLE "TimeOff" ADD CONSTRAINT "TimeOff_end_after_start" CHECK ("end" > "start");
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_end_after_start" CHECK ("end" > "start");

-- Weekdays are 0-6 (0 = Sunday).
ALTER TABLE "Availability" ADD CONSTRAINT "Availability_weekday_range" CHECK ("weekday" BETWEEN 0 AND 6);
ALTER TABLE "CoverageRule" ADD CONSTRAINT "CoverageRule_weekday_range" CHECK ("weekday" IS NULL OR "weekday" BETWEEN 0 AND 6);

-- Counts and scores in range.
ALTER TABLE "CoverageRule" ADD CONSTRAINT "CoverageRule_minCount_nonneg" CHECK ("minCount" >= 0);
ALTER TABLE "Crew" ADD CONSTRAINT "Crew_reliability_range" CHECK ("reliability" BETWEEN 0 AND 1);
ALTER TABLE "CallOut" ADD CONSTRAINT "CallOut_parseConfidence_range" CHECK ("parseConfidence" IS NULL OR "parseConfidence" BETWEEN 0 AND 1);
