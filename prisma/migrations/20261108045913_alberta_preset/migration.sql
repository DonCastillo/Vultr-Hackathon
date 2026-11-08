-- AlterEnum
ALTER TYPE "Jurisdiction" ADD VALUE 'ALBERTA' BEFORE 'ONTARIO';

-- AlterTable
ALTER TABLE "RuleConfig" ADD COLUMN     "youthUnderAge" SMALLINT NOT NULL DEFAULT 15,
ALTER COLUMN "minRestHours" SET DEFAULT 8,
ALTER COLUMN "youthMaxSchoolDayHours" SET DEFAULT 2,
ALTER COLUMN "youthMaxSchoolWeekHours" DROP NOT NULL,
ALTER COLUMN "youthMaxSchoolWeekHours" DROP DEFAULT,
ALTER COLUMN "youthLatestEnd" SET DEFAULT '21:00:00'::time without time zone;

-- AlterTable
ALTER TABLE "Store" ALTER COLUMN "timezone" SET DEFAULT 'America/Edmonton',
ALTER COLUMN "jurisdiction" SET DEFAULT 'ALBERTA';

-- Raw SQL: youth age cut-off must be a plausible age.
ALTER TABLE "RuleConfig" ADD CONSTRAINT "RuleConfig_youthUnderAge_range" CHECK ("youthUnderAge" BETWEEN 0 AND 18);
