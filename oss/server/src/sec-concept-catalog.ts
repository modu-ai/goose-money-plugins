/** Finite raw-input catalog. NOT a financial-role mapping or taxonomy-version inference.
 * Source review and non-equivalence notes: docs/sec-financial-concepts-research.md.
 * Existing request/response contracts remain v1. No runtime I/O or registration occurs.
 */
export const SEC_CONCEPT_CATALOG_VERSION = '2026-10-22.raw-inputs.v1' as const;

export const SEC_US_GAAP_CONCEPTS = Object.freeze([
  "Revenues",
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "NetIncomeLoss",
  "Assets",
  "Liabilities",
  "StockholdersEquity",
  "CashAndCashEquivalentsAtCarryingValue",
  "NetCashProvidedByUsedInOperatingActivities",
  "PaymentsToAcquirePropertyPlantAndEquipment",
  "EarningsPerShareDiluted",
  "WeightedAverageNumberOfDilutedSharesOutstanding",
  "CommonStockSharesOutstanding",
  "OperatingIncomeLoss",
  "WeightedAverageNumberOfSharesOutstandingBasic",
  "NetIncomeLossAvailableToCommonStockholdersBasic",
  "ProfitLoss",
  "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
  "ShortTermBorrowings",
  "LongTermDebtCurrent",
  "LongTermDebtNoncurrent",
  "LongTermDebt",
  "LongTermDebtAndCapitalLeaseObligationsCurrent",
  "LongTermDebtAndCapitalLeaseObligations",
  "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities",
  "CommercialPaper",
  "PaymentsToAcquireIntangibleAssets",
] as const);

export const SEC_IFRS_FULL_CONCEPTS = Object.freeze([
  "Revenue",
  "ProfitLoss",
  "Assets",
  "Liabilities",
  "Equity",
  "CashAndCashEquivalents",
  "ProfitLossFromOperatingActivities",
  "OperatingProfitLossOperating",
  "WeightedAverageShares",
  "AdjustedWeightedAverageShares",
  "ProfitLossAttributableToOrdinaryEquityHoldersOfParentEntity",
  "ProfitLossAttributableToOwnersOfParent",
  "EquityAttributableToOwnersOfParent",
  "Borrowings",
  "CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings",
  "CurrentPortionOfLongtermBorrowings",
  "ShorttermBorrowings",
  "LongtermBorrowings",
  "CashFlowsFromUsedInOperatingActivities",
  "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
  "PurchaseOfIntangibleAssetsClassifiedAsInvestingActivities",
] as const);

export type SecTaxonomy = 'us-gaap' | 'ifrs-full';
export type SecConceptName = typeof SEC_US_GAAP_CONCEPTS[number] | typeof SEC_IFRS_FULL_CONCEPTS[number];
export function isSecConceptAllowed(taxonomy: unknown, concept: unknown): concept is SecConceptName {
  if (typeof concept !== 'string') return false;
  return taxonomy === 'us-gaap' ? (SEC_US_GAAP_CONCEPTS as readonly string[]).includes(concept)
    : taxonomy === 'ifrs-full' ? (SEC_IFRS_FULL_CONCEPTS as readonly string[]).includes(concept) : false;
}

/** Documentation warnings only. Never establishes an actual fact's semantics or chooses a substitute. */
export const SEC_CONCEPT_DISTINCTIONS = Object.freeze({
  "us-gaap:NetIncomeLoss": "Parent-attributable income is not consolidated total income including noncontrolling interests, nor income available only to common shareholders.",
  "us-gaap:ProfitLoss": "Consolidated income includes noncontrolling interests; do not substitute parent-attributable or common-shareholder income.",
  "us-gaap:NetIncomeLossAvailableToCommonStockholdersBasic": "Common-shareholder basic numerator reflects tax, noncontrolling interests, preferred dividends and participating securities. Not total or parent-only income; no report-role binding is performed.",
  "us-gaap:StockholdersEquity": "Parent equity excludes noncontrolling interests and temporary equity; it is not automatically common-only equity or consolidated total equity.",
  "us-gaap:StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest": "Parent plus noncontrolling equity excludes temporary equity; not common-only equity.",
  "us-gaap:WeightedAverageNumberOfSharesOutstandingBasic": "Basic weighted shares or units remain distinct from diluted weighted shares and point-in-time shares. Common-share class and report-role suitability require separate verification.",
  "us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding": "Diluted EPS/EPU denominator; never silently substitute for basic weighted common shares.",
  "us-gaap:CommonStockSharesOutstanding": "Point-in-time outstanding common shares are not a duration-weighted basic denominator.",
  "us-gaap:OperatingIncomeLoss": "Operating result, not net income, EBITDA or an inferred margin.",
  "us-gaap:ShortTermBorrowings": "Short initial-term debt carrying amount; component overlap and completeness must be checked separately before any total-debt calculation.",
  "us-gaap:LongTermDebtCurrent": "Current classification of long-term debt, net of the specified debt adjustments and excluding leases. Not an additional component when a covering aggregate is used.",
  "us-gaap:LongTermDebtNoncurrent": "Noncurrent classification of long-term debt, net of the specified debt adjustments and excluding leases.",
  "us-gaap:LongTermDebt": "Long-term debt across classifications, net of the specified debt adjustments and excluding leases. Not interchangeable with LongTermDebtNoncurrent or total interest-bearing debt.",
  "us-gaap:LongTermDebtAndCapitalLeaseObligationsCurrent": "Current debt-and-lease combination; not interchangeable with the lease-excluding current debt concept.",
  "us-gaap:LongTermDebtAndCapitalLeaseObligations": "Despite its name, the documented amount is NONCURRENT debt plus lease obligations. Not the all-maturity aggregate.",
  "us-gaap:LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities": "Debt-and-lease combination including the current portion. Do not add overlapping current or noncurrent aggregates without separate verification.",
  "us-gaap:CommercialPaper": "Borrower-side short-term unsecured debt carrying amount; may overlap ShortTermBorrowings. Not the investment asset CommercialPaperAtCarryingValue.",
  "us-gaap:PaymentsToAcquireIntangibleAssets": "Intangible-asset cash purchases excluding goodwill; not total capex and no addition to PPE purchases is performed.",
  "us-gaap:PaymentsToAcquirePropertyPlantAndEquipment": "PPE cash purchases alone do not establish the report definition that also includes intangible-asset purchases.",
  "ifrs-full:ProfitLossFromOperatingActivities": "IAS 1 presentation concept; not an alias for the IFRS 18 operating-category subtotal. Reporting-standard adoption must be verified separately.",
  "ifrs-full:OperatingProfitLossOperating": "IFRS 18 early-application operating-category subtotal in the 2025 taxonomy; not an alias for the IAS 1 operating-activities concept.",
  "ifrs-full:WeightedAverageShares": "Basic EPS ordinary-share weighted denominator; not diluted weighted shares or point-in-time outstanding shares.",
  "ifrs-full:AdjustedWeightedAverageShares": "Diluted EPS denominator including potential ordinary shares; never silently substitute for basic weighted shares.",
  "ifrs-full:ProfitLossAttributableToOrdinaryEquityHoldersOfParentEntity": "Basic EPS ordinary-equity-holder numerator; distinct from parent-owner income and total income.",
  "ifrs-full:ProfitLossAttributableToOwnersOfParent": "Parent-owner income is not automatically ordinary-equity-holder basic EPS income or consolidated total income.",
  "ifrs-full:EquityAttributableToOwnersOfParent": "Parent-owner equity excludes noncontrolling interests; it is not automatically common-only equity.",
  "ifrs-full:Equity": "Residual total equity is not automatically parent-owner or common-only equity.",
  "ifrs-full:ProfitLoss": "Total profit/loss excludes other comprehensive income; not automatically parent-owner or ordinary-equity-holder income.",
  "ifrs-full:Borrowings": "Outstanding repayable funds; interest-bearing scope, lease treatment, completeness and overlapping components remain unresolved.",
  "ifrs-full:CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings": "Combined current borrowings and current portion of noncurrent borrowings; not disjoint from either component.",
  "ifrs-full:CurrentPortionOfLongtermBorrowings": "Current portion of noncurrent borrowings; not interchangeable with current borrowings alone.",
  "ifrs-full:ShorttermBorrowings": "Documented as current borrowings; do not infer equivalence to US GAAP initial-term short-term debt.",
  "ifrs-full:LongtermBorrowings": "Documented as the NONCURRENT portion of noncurrent borrowings, not an all-maturity total.",
  "ifrs-full:CashFlowsFromUsedInOperatingActivities": "IAS 1 and IFRS 18 documentation differs. Taxonomy name alone does not establish accounting basis, adoption or comparable cash-flow classification.",
  "ifrs-full:PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities": "PPE purchase cash outflow classified as investing; not total capex and no aggregation or sign conversion is performed.",
  "ifrs-full:PurchaseOfIntangibleAssetsClassifiedAsInvestingActivities": "Intangible purchase cash outflow classified as investing; not total capex and no aggregation or sign conversion is performed.",
} as const);

// Each namespace is a separate catalog. A shared local name across namespaces is intentional.
for (const names of [SEC_US_GAAP_CONCEPTS, SEC_IFRS_FULL_CONCEPTS]) {
  if (new Set(names).size !== names.length) throw new Error('duplicate_sec_concept_catalog_entry');
}
