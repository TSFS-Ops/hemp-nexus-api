
-- Composite index for the primary query path: "find active bids/offers for product X"
CREATE INDEX IF NOT EXISTS idx_trade_orders_side_product_status 
ON public.trade_orders (side, product, status);

-- Org-scoped index for RLS performance
CREATE INDEX IF NOT EXISTS idx_trade_orders_org_id 
ON public.trade_orders (org_id);
