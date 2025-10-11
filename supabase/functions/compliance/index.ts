import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { errorResponse, ApiException } from '../_shared/errors.ts';
import { authenticateRequest } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get('ALLOWED_ORIGINS') || '*';
  const headers = corsHeaders(allowedOrigins);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
    const url = new URL(req.url);

    // POST /compliance/documents - Upload compliance document
    if (req.method === 'POST' && url.pathname.includes('/documents')) {
      const contentType = req.headers.get('content-type') || '';
      
      if (!contentType.includes('multipart/form-data')) {
        throw new ApiException('VALIDATION_ERROR', 'Content-Type must be multipart/form-data', 400);
      }

      const formData = await req.formData();
      const file = formData.get('file') as File;
      const type = formData.get('type') as string;

      if (!file) {
        throw new ApiException('VALIDATION_ERROR', 'File is required', 400);
      }

      if (!type || !['business_registration', 'government_id', 'licence', 'coa', 'other'].includes(type)) {
        throw new ApiException('VALIDATION_ERROR', 'Invalid document type', 400);
      }

      // Validate file size (10MB max)
      if (file.size > 10 * 1024 * 1024) {
        throw new ApiException('VALIDATION_ERROR', 'File size exceeds 10MB limit', 400);
      }

      // Validate mime type
      const allowedMimeTypes = ['application/pdf', 'image/jpeg', 'image/png'];
      if (!allowedMimeTypes.includes(file.type)) {
        throw new ApiException('VALIDATION_ERROR', 'File must be PDF, JPG, or PNG', 400);
      }

      // Generate file hash
      const arrayBuffer = await file.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const fileHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      // Upload to storage
      const fileName = `${authCtx.orgId}/${crypto.randomUUID()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('compliance-documents')
        .upload(fileName, arrayBuffer, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) throw uploadError;

      // Get public URL (signed)
      const { data: urlData } = await supabase.storage
        .from('compliance-documents')
        .createSignedUrl(fileName, 3600);

      // Create certificate record
      const { data: certificate, error: dbError } = await supabase
        .from('certificates')
        .insert({
          org_id: authCtx.orgId,
          type,
          file_url: fileName,
          file_hash: fileHash,
          mime_type: file.type,
          uploaded_by: authCtx.userId || null,
        })
        .select()
        .single();

      if (dbError) throw dbError;

      await supabase.from('audit_logs').insert({
        org_id: authCtx.orgId,
        actor_user_id: authCtx.userId || null,
        action: 'compliance.document_uploaded',
        entity_type: 'certificate',
        entity_id: certificate.id,
        metadata: { type, file_name: file.name },
      });

      return new Response(
        JSON.stringify({
          id: certificate.id,
          type: certificate.type,
          status: certificate.status,
          uploaded_at: certificate.uploaded_at,
          url: urlData?.signedUrl,
        }),
        { status: 201, headers: { 'Content-Type': 'application/json', ...headers } }
      );
    }

    // GET /compliance/status - Get compliance status for org
    if (req.method === 'GET' && url.pathname.includes('/status')) {
      const orgId = url.searchParams.get('org_id') || authCtx.orgId;

      // Only allow viewing own org unless admin
      if (orgId !== authCtx.orgId && !authCtx.roles.includes('admin') && !authCtx.roles.includes('auditor')) {
        throw new ApiException('FORBIDDEN', 'Cannot view other organizations', 403);
      }

      const { data: certificates, error } = await supabase
        .from('certificates')
        .select('id, type, status, uploaded_at, reviewed_at')
        .eq('org_id', orgId);

      if (error) throw error;

      // Calculate compliance status
      const requiredTypes = ['business_registration', 'government_id', 'licence'];
      const approvedTypes = certificates
        ?.filter(c => c.status === 'approved')
        .map(c => c.type) || [];

      const isCompliant = requiredTypes.every(type => approvedTypes.includes(type));
      const pendingCount = certificates?.filter(c => c.status === 'pending').length || 0;
      const approvedCount = certificates?.filter(c => c.status === 'approved').length || 0;
      const rejectedCount = certificates?.filter(c => c.status === 'rejected').length || 0;

      return new Response(
        JSON.stringify({
          org_id: orgId,
          is_compliant: isCompliant,
          summary: {
            total: certificates?.length || 0,
            pending: pendingCount,
            approved: approvedCount,
            rejected: rejectedCount,
          },
          certificates,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...headers } }
      );
    }

    throw new ApiException('NOT_FOUND', 'Endpoint not found', 404);
  } catch (error) {
    return errorResponse(error as Error, requestId, headers);
  }
});
