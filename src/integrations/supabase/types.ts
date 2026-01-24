export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      admin_audit_logs: {
        Row: {
          action: string
          admin_user_id: string
          created_at: string
          details: Json | null
          id: string
          ip_address: string | null
          target_id: string | null
          target_type: string
        }
        Insert: {
          action: string
          admin_user_id: string
          created_at?: string
          details?: Json | null
          id?: string
          ip_address?: string | null
          target_id?: string | null
          target_type: string
        }
        Update: {
          action?: string
          admin_user_id?: string
          created_at?: string
          details?: Json | null
          id?: string
          ip_address?: string | null
          target_id?: string | null
          target_type?: string
        }
        Relationships: []
      }
      admin_risk_items: {
        Row: {
          created_at: string
          description: string | null
          id: string
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      admin_settings: {
        Row: {
          created_at: string
          id: string
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          environment: string | null
          expires_at: string | null
          expiry_warning_sent: boolean | null
          id: string
          key_hash: string
          key_history: Json | null
          last_used_at: string | null
          name: string
          org_id: string
          revoked_at: string | null
          scopes: string[]
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          environment?: string | null
          expires_at?: string | null
          expiry_warning_sent?: boolean | null
          id?: string
          key_hash: string
          key_history?: Json | null
          last_used_at?: string | null
          name: string
          org_id: string
          revoked_at?: string | null
          scopes?: string[]
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          environment?: string | null
          expires_at?: string | null
          expiry_warning_sent?: boolean | null
          id?: string
          key_hash?: string
          key_history?: Json | null
          last_used_at?: string | null
          name?: string
          org_id?: string
          revoked_at?: string | null
          scopes?: string[]
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_request_logs: {
        Row: {
          api_key_id: string | null
          created_at: string
          endpoint: string
          error_message: string | null
          id: string
          idempotency_key: string | null
          ip_address: string | null
          method: string
          org_id: string
          request_body: Json | null
          request_id: string | null
          response_body: Json | null
          response_time_ms: number
          status_code: number
          user_agent: string | null
        }
        Insert: {
          api_key_id?: string | null
          created_at?: string
          endpoint: string
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          ip_address?: string | null
          method: string
          org_id: string
          request_body?: Json | null
          request_id?: string | null
          response_body?: Json | null
          response_time_ms: number
          status_code: number
          user_agent?: string | null
        }
        Update: {
          api_key_id?: string | null
          created_at?: string
          endpoint?: string
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          ip_address?: string | null
          method?: string
          org_id?: string
          request_body?: Json | null
          request_id?: string | null
          response_body?: Json | null
          response_time_ms?: number
          status_code?: number
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_request_logs_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_request_logs_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_request_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_api_key_id: string | null
          actor_user_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json | null
          org_id: string
        }
        Insert: {
          action: string
          actor_api_key_id?: string | null
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json | null
          org_id: string
        }
        Update: {
          action?: string
          actor_api_key_id?: string | null
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json | null
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_api_key_id_fkey"
            columns: ["actor_api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_actor_api_key_id_fkey"
            columns: ["actor_api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_rate_limits: {
        Row: {
          created_at: string
          failed_attempts: number
          id: string
          identifier: string
          identifier_type: string
          last_failed_at: string | null
          locked_until: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          failed_attempts?: number
          id?: string
          identifier: string
          identifier_type: string
          last_failed_at?: string | null
          locked_until?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          failed_attempts?: number
          id?: string
          identifier?: string
          identifier_type?: string
          last_failed_at?: string | null
          locked_until?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      behavioral_signals: {
        Row: {
          action_type: string
          created_at: string
          id: string
          match_id: string | null
          metadata: Json | null
          session_id: string | null
        }
        Insert: {
          action_type: string
          created_at?: string
          id?: string
          match_id?: string | null
          metadata?: Json | null
          session_id?: string | null
        }
        Update: {
          action_type?: string
          created_at?: string
          id?: string
          match_id?: string | null
          metadata?: Json | null
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "behavioral_signals_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "match_evidence"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "behavioral_signals_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      consents: {
        Row: {
          data_source_id: string
          expires_at: string | null
          granted_at: string
          granted_by: string | null
          id: string
          org_id: string
          revoked_at: string | null
          scope: Json
        }
        Insert: {
          data_source_id: string
          expires_at?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          org_id: string
          revoked_at?: string | null
          scope?: Json
        }
        Update: {
          data_source_id?: string
          expires_at?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          org_id?: string
          revoked_at?: string | null
          scope?: Json
        }
        Relationships: [
          {
            foreignKeyName: "consents_data_source_id_fkey"
            columns: ["data_source_id"]
            isOneToOne: false
            referencedRelation: "data_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consents_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      data_source_performance: {
        Row: {
          created_at: string
          data_source_id: string
          id: string
          location: string | null
          options_returned: number
          options_selected: number
          org_id: string
          product_category: string | null
          response_time_ms: number
          search_success: boolean
          signal_id: string
          signal_type: string | null
        }
        Insert: {
          created_at?: string
          data_source_id: string
          id?: string
          location?: string | null
          options_returned?: number
          options_selected?: number
          org_id: string
          product_category?: string | null
          response_time_ms: number
          search_success?: boolean
          signal_id: string
          signal_type?: string | null
        }
        Update: {
          created_at?: string
          data_source_id?: string
          id?: string
          location?: string | null
          options_returned?: number
          options_selected?: number
          org_id?: string
          product_category?: string | null
          response_time_ms?: number
          search_success?: boolean
          signal_id?: string
          signal_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "data_source_performance_data_source_id_fkey"
            columns: ["data_source_id"]
            isOneToOne: false
            referencedRelation: "data_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_source_performance_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_source_performance_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      data_source_registrations: {
        Row: {
          api_documentation: string | null
          certifications: Json | null
          company_description: string | null
          company_name: string
          company_website: string | null
          contact_email: string
          contact_phone: string | null
          created_at: string
          data_source_name: string
          data_source_type: string
          endpoint_url: string | null
          id: string
          org_id: string | null
          regulatory_licenses: Json | null
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          submitted_by: string | null
          supported_products: Json | null
          supported_regions: Json | null
          updated_at: string
          verification_documents: Json | null
        }
        Insert: {
          api_documentation?: string | null
          certifications?: Json | null
          company_description?: string | null
          company_name: string
          company_website?: string | null
          contact_email: string
          contact_phone?: string | null
          created_at?: string
          data_source_name: string
          data_source_type: string
          endpoint_url?: string | null
          id?: string
          org_id?: string | null
          regulatory_licenses?: Json | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_by?: string | null
          supported_products?: Json | null
          supported_regions?: Json | null
          updated_at?: string
          verification_documents?: Json | null
        }
        Update: {
          api_documentation?: string | null
          certifications?: Json | null
          company_description?: string | null
          company_name?: string
          company_website?: string | null
          contact_email?: string
          contact_phone?: string | null
          created_at?: string
          data_source_name?: string
          data_source_type?: string
          endpoint_url?: string | null
          id?: string
          org_id?: string | null
          regulatory_licenses?: Json | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_by?: string | null
          supported_products?: Json | null
          supported_regions?: Json | null
          updated_at?: string
          verification_documents?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "data_source_registrations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_source_registrations_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_source_registrations_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      data_sources: {
        Row: {
          config: Json
          created_at: string
          id: string
          last_queried_at: string | null
          name: string
          org_id: string
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          id?: string
          last_queried_at?: string | null
          name: string
          org_id: string
          status?: string
          type: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          last_queried_at?: string | null
          name?: string
          org_id?: string
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_sources_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_access: {
        Row: {
          access_type: string
          created_at: string
          document_id: string
          granted_by_user_id: string
          granted_to_org_id: string | null
          granted_to_user_id: string | null
          id: string
          revoked_at: string | null
          revoked_by_user_id: string | null
        }
        Insert: {
          access_type?: string
          created_at?: string
          document_id: string
          granted_by_user_id: string
          granted_to_org_id?: string | null
          granted_to_user_id?: string | null
          id?: string
          revoked_at?: string | null
          revoked_by_user_id?: string | null
        }
        Update: {
          access_type?: string
          created_at?: string
          document_id?: string
          granted_by_user_id?: string
          granted_to_org_id?: string | null
          granted_to_user_id?: string | null
          id?: string
          revoked_at?: string | null
          revoked_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_access_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "match_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_access_granted_to_org_id_fkey"
            columns: ["granted_to_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_access_logs: {
        Row: {
          access_reason: string | null
          accessor_org_id: string | null
          accessor_user_id: string
          action: string
          created_at: string
          document_id: string
          id: string
          ip_address: string | null
          is_admin_access: boolean
          match_id: string
          metadata: Json | null
          user_agent: string | null
        }
        Insert: {
          access_reason?: string | null
          accessor_org_id?: string | null
          accessor_user_id: string
          action: string
          created_at?: string
          document_id: string
          id?: string
          ip_address?: string | null
          is_admin_access?: boolean
          match_id: string
          metadata?: Json | null
          user_agent?: string | null
        }
        Update: {
          access_reason?: string | null
          accessor_org_id?: string | null
          accessor_user_id?: string
          action?: string
          created_at?: string
          document_id?: string
          id?: string
          ip_address?: string | null
          is_admin_access?: boolean
          match_id?: string
          metadata?: Json | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_access_logs_accessor_org_id_fkey"
            columns: ["accessor_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_access_logs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "match_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_access_logs_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "match_evidence"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "document_access_logs_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      idempotency_keys: {
        Row: {
          created_at: string
          endpoint: string
          expires_at: string
          id: string
          idempotency_key: string
          org_id: string
          request_hash: string
          response_data: Json
          response_status_code: number
        }
        Insert: {
          created_at?: string
          endpoint: string
          expires_at?: string
          id?: string
          idempotency_key: string
          org_id: string
          request_hash: string
          response_data: Json
          response_status_code: number
        }
        Update: {
          created_at?: string
          endpoint?: string
          expires_at?: string
          id?: string
          idempotency_key?: string
          org_id?: string
          request_hash?: string
          response_data?: Json
          response_status_code?: number
        }
        Relationships: [
          {
            foreignKeyName: "idempotency_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      match_analytics: {
        Row: {
          avg_match_time_hours: number | null
          avg_options_per_signal: number | null
          created_at: string
          data_source_id: string | null
          id: string
          is_cross_border: boolean | null
          match_rate: number | null
          period_end: string
          period_start: string
          period_type: string
          product_category: string | null
          provider_success_rate: number | null
          signal_type: string | null
          source_country: string | null
          source_region: string | null
          target_country: string | null
          target_region: string | null
          total_matches: number | null
          total_options: number | null
          total_signals: number | null
        }
        Insert: {
          avg_match_time_hours?: number | null
          avg_options_per_signal?: number | null
          created_at?: string
          data_source_id?: string | null
          id?: string
          is_cross_border?: boolean | null
          match_rate?: number | null
          period_end: string
          period_start: string
          period_type: string
          product_category?: string | null
          provider_success_rate?: number | null
          signal_type?: string | null
          source_country?: string | null
          source_region?: string | null
          target_country?: string | null
          target_region?: string | null
          total_matches?: number | null
          total_options?: number | null
          total_signals?: number | null
        }
        Update: {
          avg_match_time_hours?: number | null
          avg_options_per_signal?: number | null
          created_at?: string
          data_source_id?: string | null
          id?: string
          is_cross_border?: boolean | null
          match_rate?: number | null
          period_end?: string
          period_start?: string
          period_type?: string
          product_category?: string | null
          provider_success_rate?: number | null
          signal_type?: string | null
          source_country?: string | null
          source_region?: string | null
          target_country?: string | null
          target_region?: string | null
          total_matches?: number | null
          total_options?: number | null
          total_signals?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "match_analytics_data_source_id_fkey"
            columns: ["data_source_id"]
            isOneToOne: false
            referencedRelation: "data_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      match_documents: {
        Row: {
          created_at: string
          doc_type: string
          expiry_date: string | null
          file_size: number | null
          filename: string
          id: string
          match_id: string
          mime_type: string | null
          notes: string | null
          org_id: string
          sha256_hash: string
          status: string
          storage_path: string
          supersedes_document_id: string | null
          title: string | null
          updated_at: string
          uploader_org_id: string | null
          uploader_user_id: string | null
          valid_from: string | null
          valid_to: string | null
          verification_notes: string | null
          verified_at: string | null
          verified_by: string | null
          version: number
          visibility: string
        }
        Insert: {
          created_at?: string
          doc_type: string
          expiry_date?: string | null
          file_size?: number | null
          filename: string
          id?: string
          match_id: string
          mime_type?: string | null
          notes?: string | null
          org_id: string
          sha256_hash: string
          status?: string
          storage_path: string
          supersedes_document_id?: string | null
          title?: string | null
          updated_at?: string
          uploader_org_id?: string | null
          uploader_user_id?: string | null
          valid_from?: string | null
          valid_to?: string | null
          verification_notes?: string | null
          verified_at?: string | null
          verified_by?: string | null
          version?: number
          visibility?: string
        }
        Update: {
          created_at?: string
          doc_type?: string
          expiry_date?: string | null
          file_size?: number | null
          filename?: string
          id?: string
          match_id?: string
          mime_type?: string | null
          notes?: string | null
          org_id?: string
          sha256_hash?: string
          status?: string
          storage_path?: string
          supersedes_document_id?: string | null
          title?: string | null
          updated_at?: string
          uploader_org_id?: string | null
          uploader_user_id?: string | null
          valid_from?: string | null
          valid_to?: string | null
          verification_notes?: string | null
          verified_at?: string | null
          verified_by?: string | null
          version?: number
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_documents_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "match_evidence"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "match_documents_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_documents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_documents_supersedes_document_id_fkey"
            columns: ["supersedes_document_id"]
            isOneToOne: false
            referencedRelation: "match_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_documents_uploader_org_id_fkey"
            columns: ["uploader_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_documents_uploader_user_id_fkey"
            columns: ["uploader_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      match_events: {
        Row: {
          actor_api_key_id: string | null
          actor_user_id: string | null
          created_at: string
          event_data: Json
          event_type: string
          id: string
          match_id: string
          org_id: string
          payload_hash: string
          previous_event_hash: string | null
        }
        Insert: {
          actor_api_key_id?: string | null
          actor_user_id?: string | null
          created_at?: string
          event_data?: Json
          event_type: string
          id?: string
          match_id: string
          org_id: string
          payload_hash: string
          previous_event_hash?: string | null
        }
        Update: {
          actor_api_key_id?: string | null
          actor_user_id?: string | null
          created_at?: string
          event_data?: Json
          event_type?: string
          id?: string
          match_id?: string
          org_id?: string
          payload_hash?: string
          previous_event_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "match_events_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "match_evidence"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "match_events_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          buyer_id: string
          buyer_name: string
          buyer_org_id: string | null
          commodity: string
          created_at: string
          created_by: string | null
          event_chain_hash: string | null
          hash: string
          id: string
          metadata: Json | null
          org_id: string
          previous_event_hash: string | null
          price_amount: number
          price_currency: string
          quantity_amount: number
          quantity_unit: string
          seller_id: string
          seller_name: string
          seller_org_id: string | null
          settled_at: string | null
          status: string
          terms: string | null
        }
        Insert: {
          buyer_id: string
          buyer_name: string
          buyer_org_id?: string | null
          commodity: string
          created_at?: string
          created_by?: string | null
          event_chain_hash?: string | null
          hash: string
          id?: string
          metadata?: Json | null
          org_id: string
          previous_event_hash?: string | null
          price_amount: number
          price_currency: string
          quantity_amount: number
          quantity_unit: string
          seller_id: string
          seller_name: string
          seller_org_id?: string | null
          settled_at?: string | null
          status?: string
          terms?: string | null
        }
        Update: {
          buyer_id?: string
          buyer_name?: string
          buyer_org_id?: string | null
          commodity?: string
          created_at?: string
          created_by?: string | null
          event_chain_hash?: string | null
          hash?: string
          id?: string
          metadata?: Json | null
          org_id?: string
          previous_event_hash?: string | null
          price_amount?: number
          price_currency?: string
          quantity_amount?: number
          quantity_unit?: string
          seller_id?: string
          seller_name?: string
          seller_org_id?: string | null
          settled_at?: string | null
          status?: string
          terms?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "matches_buyer_org_id_fkey"
            columns: ["buyer_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_seller_org_id_fkey"
            columns: ["seller_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      options: {
        Row: {
          confidence_score: number | null
          created_at: string
          currency: string | null
          data_source_id: string
          freshness: string
          how_much: number
          id: string
          price: number | null
          quality_flags: Json | null
          score: number | null
          signal_id: string
          source_link: string | null
          unit: string
          what: string
          when_available: string | null
          where_location: string | null
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string
          currency?: string | null
          data_source_id: string
          freshness?: string
          how_much: number
          id?: string
          price?: number | null
          quality_flags?: Json | null
          score?: number | null
          signal_id: string
          source_link?: string | null
          unit: string
          what: string
          when_available?: string | null
          where_location?: string | null
        }
        Update: {
          confidence_score?: number | null
          created_at?: string
          currency?: string | null
          data_source_id?: string
          freshness?: string
          how_much?: number
          id?: string
          price?: number | null
          quality_flags?: Json | null
          score?: number | null
          signal_id?: string
          source_link?: string | null
          unit?: string
          what?: string
          when_available?: string | null
          where_location?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "options_data_source_id_fkey"
            columns: ["data_source_id"]
            isOneToOne: false
            referencedRelation: "data_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "options_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          sandbox_enabled: boolean | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sandbox_enabled?: boolean | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sandbox_enabled?: boolean | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          org_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          org_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          org_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          api_key_id: string | null
          created_at: string
          endpoint: string
          id: string
          org_id: string
          request_count: number
          updated_at: string
          window_end: string
          window_start: string
        }
        Insert: {
          api_key_id?: string | null
          created_at?: string
          endpoint: string
          id?: string
          org_id: string
          request_count?: number
          updated_at?: string
          window_end: string
          window_start?: string
        }
        Update: {
          api_key_id?: string | null
          created_at?: string
          endpoint?: string
          id?: string
          org_id?: string
          request_count?: number
          updated_at?: string
          window_end?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_limits_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rate_limits_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rate_limits_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      reputation_scores: {
        Row: {
          avg_response_time_seconds: number | null
          completion_score: number | null
          created_at: string
          first_match_at: string | null
          id: string
          last_match_at: string | null
          median_response_time_seconds: number | null
          org_id: string
          overall_score: number | null
          reliability_score: number | null
          reputation_level: string | null
          responsiveness_score: number | null
          total_matches_completed: number
          total_matches_failed: number
          total_options_selected: number
          total_signals_created: number
          updated_at: string
        }
        Insert: {
          avg_response_time_seconds?: number | null
          completion_score?: number | null
          created_at?: string
          first_match_at?: string | null
          id?: string
          last_match_at?: string | null
          median_response_time_seconds?: number | null
          org_id: string
          overall_score?: number | null
          reliability_score?: number | null
          reputation_level?: string | null
          responsiveness_score?: number | null
          total_matches_completed?: number
          total_matches_failed?: number
          total_options_selected?: number
          total_signals_created?: number
          updated_at?: string
        }
        Update: {
          avg_response_time_seconds?: number | null
          completion_score?: number | null
          created_at?: string
          first_match_at?: string | null
          id?: string
          last_match_at?: string | null
          median_response_time_seconds?: number | null
          org_id?: string
          overall_score?: number | null
          reliability_score?: number | null
          reputation_level?: string | null
          responsiveness_score?: number | null
          total_matches_completed?: number
          total_matches_failed?: number
          total_options_selected?: number
          total_signals_created?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reputation_scores_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sdk_examples: {
        Row: {
          code_snippet: string
          created_at: string
          description: string | null
          example_type: string
          id: string
          language: string
          updated_at: string
        }
        Insert: {
          code_snippet: string
          created_at?: string
          description?: string | null
          example_type: string
          id?: string
          language: string
          updated_at?: string
        }
        Update: {
          code_snippet?: string
          created_at?: string
          description?: string | null
          example_type?: string
          id?: string
          language?: string
          updated_at?: string
        }
        Relationships: []
      }
      selections: {
        Row: {
          handoff_data: Json | null
          handoff_status: string | null
          handoff_token: string | null
          id: string
          option_id: string
          selected_at: string
          selected_by: string | null
          signal_id: string
        }
        Insert: {
          handoff_data?: Json | null
          handoff_status?: string | null
          handoff_token?: string | null
          id?: string
          option_id: string
          selected_at?: string
          selected_by?: string | null
          signal_id: string
        }
        Update: {
          handoff_data?: Json | null
          handoff_status?: string | null
          handoff_token?: string | null
          id?: string
          option_id?: string
          selected_at?: string
          selected_by?: string | null
          signal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "selections_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "selections_selected_by_fkey"
            columns: ["selected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "selections_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      signals: {
        Row: {
          content: Json
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          org_id: string
          status: string
          type: Database["public"]["Enums"]["signal_type"]
          updated_at: string
        }
        Insert: {
          content: Json
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          org_id: string
          status?: string
          type: Database["public"]["Enums"]["signal_type"]
          updated_at?: string
        }
        Update: {
          content?: Json
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          org_id?: string
          status?: string
          type?: Database["public"]["Enums"]["signal_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "signals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      token_balances: {
        Row: {
          balance: number
          created_at: string
          id: string
          minimum_required: number
          org_id: string
          updated_at: string
        }
        Insert: {
          balance?: number
          created_at?: string
          id?: string
          minimum_required?: number
          org_id: string
          updated_at?: string
        }
        Update: {
          balance?: number
          created_at?: string
          id?: string
          minimum_required?: number
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "token_balances_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      token_ledger: {
        Row: {
          api_key_id: string | null
          created_at: string
          endpoint: string
          id: string
          metadata: Json | null
          org_id: string
          outcome: string
          remaining_balance: number
          request_id: string | null
          tokens_burned: number
        }
        Insert: {
          api_key_id?: string | null
          created_at?: string
          endpoint: string
          id?: string
          metadata?: Json | null
          org_id: string
          outcome: string
          remaining_balance: number
          request_id?: string | null
          tokens_burned?: number
        }
        Update: {
          api_key_id?: string | null
          created_at?: string
          endpoint?: string
          id?: string
          metadata?: Json | null
          org_id?: string
          outcome?: string
          remaining_balance?: number
          request_id?: string | null
          tokens_burned?: number
        }
        Relationships: [
          {
            foreignKeyName: "token_ledger_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "token_ledger_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "token_ledger_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      webhook_deliveries: {
        Row: {
          created_at: string
          delivered_at: string
          delivery_attempt: number
          error_message: string | null
          event_type: string
          id: string
          is_dead_letter: boolean | null
          max_retries: number | null
          next_retry_at: string | null
          org_id: string
          payload: Json
          response_body: string | null
          response_status_code: number | null
          webhook_endpoint_id: string
        }
        Insert: {
          created_at?: string
          delivered_at?: string
          delivery_attempt?: number
          error_message?: string | null
          event_type: string
          id?: string
          is_dead_letter?: boolean | null
          max_retries?: number | null
          next_retry_at?: string | null
          org_id: string
          payload?: Json
          response_body?: string | null
          response_status_code?: number | null
          webhook_endpoint_id: string
        }
        Update: {
          created_at?: string
          delivered_at?: string
          delivery_attempt?: number
          error_message?: string | null
          event_type?: string
          id?: string
          is_dead_letter?: boolean | null
          max_retries?: number | null
          next_retry_at?: string | null
          org_id?: string
          payload?: Json
          response_body?: string | null
          response_status_code?: number | null
          webhook_endpoint_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_deliveries_webhook_endpoint_id_fkey"
            columns: ["webhook_endpoint_id"]
            isOneToOne: false
            referencedRelation: "webhook_endpoints"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_endpoints: {
        Row: {
          created_at: string
          events: string[]
          id: string
          last_delivery_at: string | null
          org_id: string
          secret_hash: string
          status: string
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          events?: string[]
          id?: string
          last_delivery_at?: string | null
          org_id: string
          secret_hash: string
          status?: string
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          events?: string[]
          id?: string
          last_delivery_at?: string | null
          org_id?: string
          secret_hash?: string
          status?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_endpoints_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          created_at: string
          delivered: boolean | null
          delivered_at: string | null
          error_message: string | null
          event_type: string
          id: string
          org_id: string
          payload: Json
          retry_count: number | null
          signature: string
          webhook_endpoint_id: string
        }
        Insert: {
          created_at?: string
          delivered?: boolean | null
          delivered_at?: string | null
          error_message?: string | null
          event_type: string
          id?: string
          org_id: string
          payload: Json
          retry_count?: number | null
          signature: string
          webhook_endpoint_id: string
        }
        Update: {
          created_at?: string
          delivered?: boolean | null
          delivered_at?: string | null
          error_message?: string | null
          event_type?: string
          id?: string
          org_id?: string
          payload?: Json
          retry_count?: number | null
          signature?: string
          webhook_endpoint_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_events_webhook_endpoint_id_fkey"
            columns: ["webhook_endpoint_id"]
            isOneToOne: false
            referencedRelation: "webhook_endpoints"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      api_keys_safe: {
        Row: {
          created_at: string | null
          created_by: string | null
          environment: string | null
          expires_at: string | null
          expiry_warning_sent: boolean | null
          id: string | null
          last_used_at: string | null
          name: string | null
          org_id: string | null
          revoked_at: string | null
          scopes: string[] | null
          status: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          environment?: string | null
          expires_at?: string | null
          expiry_warning_sent?: boolean | null
          id?: string | null
          last_used_at?: string | null
          name?: string | null
          org_id?: string | null
          revoked_at?: string | null
          scopes?: string[] | null
          status?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          environment?: string | null
          expires_at?: string | null
          expiry_warning_sent?: boolean | null
          id?: string | null
          last_used_at?: string | null
          name?: string | null
          org_id?: string | null
          revoked_at?: string | null
          scopes?: string[] | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      match_evidence: {
        Row: {
          event_timeline: Json | null
          match_created_at: string | null
          match_data: Json | null
          match_hash: string | null
          match_id: string | null
          org_id: string | null
          settled_at: string | null
          status: string | null
        }
        Insert: {
          event_timeline?: never
          match_created_at?: string | null
          match_data?: never
          match_hash?: string | null
          match_id?: string | null
          org_id?: string | null
          settled_at?: string | null
          status?: string | null
        }
        Update: {
          event_timeline?: never
          match_created_at?: string | null
          match_data?: never
          match_hash?: string | null
          match_id?: string | null
          org_id?: string | null
          settled_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "matches_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      match_evidence_public: {
        Row: {
          event_timeline: Json | null
          match_created_at: string | null
          match_data: Json | null
          match_hash: string | null
          match_id: string | null
          org_id: string | null
          settled_at: string | null
          status: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      check_and_increment_auth_failure: {
        Args: {
          p_base_lockout_seconds?: number
          p_identifier: string
          p_identifier_type: string
          p_max_attempts?: number
        }
        Returns: Json
      }
      check_anon_grants: {
        Args: { p_allowlist?: string[] }
        Returns: {
          object_name: string
          object_type: string
          privileges: string
          schema_name: string
        }[]
      }
      check_auth_lockout: {
        Args: { p_identifier: string; p_identifier_type: string }
        Returns: Json
      }
      check_backend_only_views: {
        Args: { p_view_names: string[] }
        Returns: {
          view_name: string
          violation: string
        }[]
      }
      check_public_exposure: {
        Args: { p_allowlist?: string[] }
        Returns: {
          object_name: string
          object_type: string
          privileges: string
          schema_name: string
        }[]
      }
      check_security_definer_views: {
        Args: never
        Returns: {
          schema_name: string
          view_name: string
          violation: string
        }[]
      }
      check_view_security_invoker: {
        Args: never
        Returns: {
          schema_name: string
          view_name: string
          violation: string
        }[]
      }
      cleanup_expired_idempotency_keys: { Args: never; Returns: number }
      cleanup_expired_rate_limits: { Args: never; Returns: number }
      cleanup_old_auth_rate_limits: { Args: never; Returns: number }
      generate_event_hash: {
        Args: { event_data: Json; event_type: string; previous_hash: string }
        Returns: string
      }
      get_match_evidence: {
        Args: { p_match_id: string; p_org_id: string }
        Returns: {
          event_timeline: Json
          match_created_at: string
          match_data: Json
          match_hash: string
          match_id: string
          org_id: string
          settled_at: string
          status: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_rate_limit: {
        Args: { p_endpoint: string; p_org_id: string; p_window_end: string }
        Returns: number
      }
      is_admin: { Args: { user_id: string }; Returns: boolean }
      reset_auth_rate_limit: {
        Args: { p_identifier: string; p_identifier_type: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "seller" | "broker" | "buyer" | "auditor"
      signal_type: "buyer" | "seller"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "seller", "broker", "buyer", "auditor"],
      signal_type: ["buyer", "seller"],
    },
  },
} as const
