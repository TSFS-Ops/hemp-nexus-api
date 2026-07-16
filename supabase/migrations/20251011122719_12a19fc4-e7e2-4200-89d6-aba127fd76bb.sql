-- SignalRank API Database Schema
-- Multi-tenant B2B marketplace with compliance, listings, orders, and broker mandates

-- Create app role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'seller', 'broker', 'buyer', 'auditor');

-- Organizations table
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Profiles table (extends auth.users with org_id)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User roles table (separate for security)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);

-- Security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- API Keys table
CREATE TABLE public.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  last_used_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked'))
);

-- Categories table
CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  parent_id UUID REFERENCES public.categories(id) ON DELETE CASCADE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Products table
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  attributes JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Listings table
CREATE TABLE public.listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL,
  price NUMERIC NOT NULL CHECK (price >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  location TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Orders table
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  seller_org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES public.listings(id) ON DELETE RESTRICT,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  price NUMERIC NOT NULL CHECK (price >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'placed', 'accepted', 'rejected', 'fulfilled', 'cancelled')),
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Broker Mandates table
CREATE TABLE public.broker_mandates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  broker_org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  scope JSONB NOT NULL DEFAULT '{}',
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Certificates table (compliance documents)
CREATE TABLE public.certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('business_registration', 'government_id', 'licence', 'coa', 'other')),
  file_url TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewer_note TEXT,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Webhook endpoints table
CREATE TABLE public.webhook_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  events TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  last_delivery_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit logs table
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_api_key_id UUID REFERENCES public.api_keys(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broker_mandates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for organizations
CREATE POLICY "Users can view their own org"
  ON public.organizations FOR SELECT
  USING (id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Admins can manage all orgs"
  ON public.organizations FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for profiles
CREATE POLICY "Users can view profiles in their org"
  ON public.profiles FOR SELECT
  USING (org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Admins can manage all profiles"
  ON public.profiles FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for user_roles
CREATE POLICY "Users can view their own roles"
  ON public.user_roles FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Admins can manage all roles"
  ON public.user_roles FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for api_keys
CREATE POLICY "Users can view their org's API keys"
  ON public.api_keys FOR SELECT
  USING (org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Admins can manage API keys"
  ON public.api_keys FOR ALL
  USING (public.has_role(auth.uid(), 'admin') OR org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

-- RLS Policies for categories (public read, admin write)
CREATE POLICY "Anyone can view categories"
  ON public.categories FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage categories"
  ON public.categories FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for products
CREATE POLICY "Users can view products in their org"
  ON public.products FOR SELECT
  USING (org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Users can manage products in their org"
  ON public.products FOR ALL
  USING (org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

-- RLS Policies for listings
CREATE POLICY "Authenticated users can view active listings"
  ON public.listings FOR SELECT
  TO authenticated
  USING (status = 'active' OR org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Users can manage their org's listings"
  ON public.listings FOR ALL
  USING (org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

-- RLS Policies for orders
CREATE POLICY "Users can view orders involving their org"
  ON public.orders FOR SELECT
  USING (buyer_org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())
         OR seller_org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Users can create orders for their org"
  ON public.orders FOR INSERT
  WITH CHECK (buyer_org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update orders involving their org"
  ON public.orders FOR UPDATE
  USING (buyer_org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())
         OR seller_org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

-- RLS Policies for broker_mandates
CREATE POLICY "Users can view mandates involving their org"
  ON public.broker_mandates FOR SELECT
  USING (principal_org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())
         OR broker_org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Users can manage mandates for their org"
  ON public.broker_mandates FOR ALL
  USING (principal_org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

-- RLS Policies for certificates
CREATE POLICY "Users can view their org's certificates"
  ON public.certificates FOR SELECT
  USING (org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()) OR public.has_role(auth.uid(), 'auditor'));

CREATE POLICY "Users can upload certificates for their org"
  ON public.certificates FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Auditors can update certificate status"
  ON public.certificates FOR UPDATE
  USING (public.has_role(auth.uid(), 'auditor') OR public.has_role(auth.uid(), 'admin'));

-- RLS Policies for webhook_endpoints
CREATE POLICY "Users can manage their org's webhooks"
  ON public.webhook_endpoints FOR ALL
  USING (org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

-- RLS Policies for audit_logs
CREATE POLICY "Admins can view all audit logs"
  ON public.audit_logs FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view their org's audit logs"
  ON public.audit_logs FOR SELECT
  USING (org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_categories_updated_at
  BEFORE UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_listings_updated_at
  BEFORE UPDATE ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_broker_mandates_updated_at
  BEFORE UPDATE ON public.broker_mandates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_webhook_endpoints_updated_at
  BEFORE UPDATE ON public.webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger to create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, org_id, email)
  VALUES (
    NEW.id,
    (NEW.raw_user_meta_data->>'org_id')::UUID,
    NEW.email
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Seed initial categories
INSERT INTO public.categories (name, slug, description) VALUES
  ('Hemp', 'hemp', 'Hemp and hemp-derived products'),
  ('Cannabis', 'cannabis', 'Cannabis and cannabis-derived products'),
  ('CBD', 'cbd', 'CBD products'),
  ('Equipment', 'equipment', 'Growing and processing equipment'),
  ('Supplies', 'supplies', 'General supplies and materials');

-- Create storage bucket for compliance documents
INSERT INTO storage.buckets (id, name, public) VALUES ('compliance-documents', 'compliance-documents', false) ON CONFLICT (id) DO NOTHING;

-- Storage policies for compliance documents
CREATE POLICY "Users can upload compliance docs for their org"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'compliance-documents' AND
    (storage.foldername(name))[1] IN (
      SELECT org_id::TEXT FROM public.profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can view their org's compliance docs"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'compliance-documents' AND
    (storage.foldername(name))[1] IN (
      SELECT org_id::TEXT FROM public.profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Auditors can view all compliance docs"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'compliance-documents' AND
    public.has_role(auth.uid(), 'auditor')
  );
