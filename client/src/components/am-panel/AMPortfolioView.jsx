import { POPortfolioHub } from "../POManagementViews";

export default function AMPortfolioView({ insights, onOpenDetails }) {
  return (
    <section className="grid gap-3">
      <POPortfolioHub insights={insights} onOpenDetails={onOpenDetails} />
    </section>
  );
}
