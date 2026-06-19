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
      _proof_results: {
        Row: {
          created_at: string
          detail: string | null
          id: number
          run_id: string
          step: string | null
        }
        Insert: {
          created_at?: string
          detail?: string | null
          id?: number
          run_id?: string
          step?: string | null
        }
        Update: {
          created_at?: string
          detail?: string | null
          id?: number
          run_id?: string
          step?: string | null
        }
        Relationships: []
      }
      acceptance_receipt_acknowledgements: {
        Row: {
          acknowledged_at: string
          acknowledging_user_email: string | null
          acknowledging_user_id: string
          acknowledging_user_name: string | null
          attestation_id: string | null
          created_at: string
          engagement_id: string
          id: string
          initiator_org_id: string
          ip_address: string | null
          match_id: string
          metadata: Json
          receipt_id: string
          receipt_signature_hash: string
          signature_hash: string
          signed_payload: string
          user_agent: string | null
        }
        Insert: {
          acknowledged_at?: string
          acknowledging_user_email?: string | null
          acknowledging_user_id: string
          acknowledging_user_name?: string | null
          attestation_id?: string | null
          created_at?: string
          engagement_id: string
          id?: string
          initiator_org_id: string
          ip_address?: string | null
          match_id: string
          metadata?: Json
          receipt_id: string
          receipt_signature_hash: string
          signature_hash: string
          signed_payload: string
          user_agent?: string | null
        }
        Update: {
          acknowledged_at?: string
          acknowledging_user_email?: string | null
          acknowledging_user_id?: string
          acknowledging_user_name?: string | null
          attestation_id?: string | null
          created_at?: string
          engagement_id?: string
          id?: string
          initiator_org_id?: string
          ip_address?: string | null
          match_id?: string
          metadata?: Json
          receipt_id?: string
          receipt_signature_hash?: string
          signature_hash?: string
          signed_payload?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "acceptance_receipt_acknowledgements_attestation_id_fkey"
            columns: ["attestation_id"]
            isOneToOne: false
            referencedRelation: "attestations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acceptance_receipt_acknowledgements_initiator_org_id_fkey"
            columns: ["initiator_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acceptance_receipt_acknowledgements_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "acceptance_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      acceptance_receipts: {
        Row: {
          accepted_at: string
          accepting_user_email: string | null
          accepting_user_id: string | null
          accepting_user_name: string | null
          attestation_id: string | null
          counterparty_email: string | null
          counterparty_org_id: string | null
          created_at: string
          engagement_id: string
          id: string
          initiator_org_id: string
          match_id: string
          metadata: Json
          receipt_version: number
          signature_hash: string
          signed_payload: string
        }
        Insert: {
          accepted_at?: string
          accepting_user_email?: string | null
          accepting_user_id?: string | null
          accepting_user_name?: string | null
          attestation_id?: string | null
          counterparty_email?: string | null
          counterparty_org_id?: string | null
          created_at?: string
          engagement_id: string
          id?: string
          initiator_org_id: string
          match_id: string
          metadata?: Json
          receipt_version?: number
          signature_hash: string
          signed_payload: string
        }
        Update: {
          accepted_at?: string
          accepting_user_email?: string | null
          accepting_user_id?: string | null
          accepting_user_name?: string | null
          attestation_id?: string | null
          counterparty_email?: string | null
          counterparty_org_id?: string | null
          created_at?: string
          engagement_id?: string
          id?: string
          initiator_org_id?: string
          match_id?: string
          metadata?: Json
          receipt_version?: number
          signature_hash?: string
          signed_payload?: string
        }
        Relationships: [
          {
            foreignKeyName: "acceptance_receipts_attestation_id_fkey"
            columns: ["attestation_id"]
            isOneToOne: false
            referencedRelation: "attestations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acceptance_receipts_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: true
            referencedRelation: "engagement_email_sent_but_status_stuck"
            referencedColumns: ["engagement_id"]
          },
          {
            foreignKeyName: "acceptance_receipts_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: true
            referencedRelation: "poi_engagements"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_audit_logs: {
        Row: {
          action: string
          admin_user_id: string | null
          created_at: string
          details: Json | null
          id: string
          ip_address: string | null
          target_id: string | null
          target_type: string
          user_agent: string | null
        }
        Insert: {
          action: string
          admin_user_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          ip_address?: string | null
          target_id?: string | null
          target_type: string
          user_agent?: string | null
        }
        Update: {
          action?: string
          admin_user_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          ip_address?: string | null
          target_id?: string | null
          target_type?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      admin_risk_items: {
        Row: {
          created_at: string
          dedup_key: string | null
          description: string | null
          id: string
          kind: string | null
          metadata: Json
          org_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          dedup_key?: string | null
          description?: string | null
          id?: string
          kind?: string | null
          metadata?: Json
          org_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          dedup_key?: string | null
          description?: string | null
          id?: string
          kind?: string | null
          metadata?: Json
          org_id?: string | null
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
      ai_call_meter: {
        Row: {
          call_type: string
          count: number
          day: string
          id: string
          org_id: string
          updated_at: string
        }
        Insert: {
          call_type: string
          count?: number
          day?: string
          id?: string
          org_id: string
          updated_at?: string
        }
        Update: {
          call_type?: string
          count?: number
          day?: string
          id?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_do_not_contact_rules: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          deactivated_at: string | null
          deactivated_by: string | null
          id: string
          reason: string | null
          rule_type: string
          rule_value: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          id?: string
          reason?: string | null
          rule_type: string
          rule_value: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          id?: string
          reason?: string | null
          rule_type?: string
          rule_value?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_intel_sources: {
        Row: {
          checked_at: string
          confidence: string | null
          created_at: string
          created_by: string | null
          field_name: string
          id: string
          proposed_match_id: string
          provider: string | null
          snippet: string | null
          source_title: string | null
          source_type: string
          source_url: string | null
        }
        Insert: {
          checked_at?: string
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          field_name: string
          id?: string
          proposed_match_id: string
          provider?: string | null
          snippet?: string | null
          source_title?: string | null
          source_type: string
          source_url?: string | null
        }
        Update: {
          checked_at?: string
          confidence?: string | null
          created_at?: string
          created_by?: string | null
          field_name?: string
          id?: string
          proposed_match_id?: string
          provider?: string | null
          snippet?: string | null
          source_title?: string | null
          source_type?: string
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_intel_sources_proposed_match_id_fkey"
            columns: ["proposed_match_id"]
            isOneToOne: false
            referencedRelation: "ai_proposed_matches"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_intel_tasks: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          due_at: string | null
          id: string
          kind: string
          match_id: string | null
          metadata: Json
          owner: string | null
          proposed_match_id: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          trade_request_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          kind: string
          match_id?: string | null
          metadata?: Json
          owner?: string | null
          proposed_match_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          trade_request_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          kind?: string
          match_id?: string | null
          metadata?: Json
          owner?: string | null
          proposed_match_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          trade_request_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_intel_tasks_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "match_evidence"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "ai_intel_tasks_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_intel_tasks_proposed_match_id_fkey"
            columns: ["proposed_match_id"]
            isOneToOne: false
            referencedRelation: "ai_proposed_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_intel_tasks_trade_request_id_fkey"
            columns: ["trade_request_id"]
            isOneToOne: false
            referencedRelation: "trade_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_outreach_drafts_v2: {
        Row: {
          approved_at: string | null
          approved_for_send_by: string | null
          created_at: string
          created_by_ai: boolean
          created_by_user_id: string | null
          draft_body: string
          draft_status: string
          draft_subject: string
          id: string
          is_first_outreach: boolean
          model: string | null
          outcome: string | null
          outcome_set_at: string | null
          outcome_set_by: string | null
          proposed_match_id: string
          recipient_email_if_known: string | null
          recipient_name: string | null
          recipient_organisation: string | null
          review_note: string | null
          reviewed_by: string | null
          send_confirmation_text: string | null
          send_confirmed_at: string | null
          send_confirmed_by: string | null
          sent_at: string | null
          sent_by_user_id: string | null
          trade_request_id: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_for_send_by?: string | null
          created_at?: string
          created_by_ai?: boolean
          created_by_user_id?: string | null
          draft_body: string
          draft_status?: string
          draft_subject: string
          id?: string
          is_first_outreach?: boolean
          model?: string | null
          outcome?: string | null
          outcome_set_at?: string | null
          outcome_set_by?: string | null
          proposed_match_id: string
          recipient_email_if_known?: string | null
          recipient_name?: string | null
          recipient_organisation?: string | null
          review_note?: string | null
          reviewed_by?: string | null
          send_confirmation_text?: string | null
          send_confirmed_at?: string | null
          send_confirmed_by?: string | null
          sent_at?: string | null
          sent_by_user_id?: string | null
          trade_request_id: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_for_send_by?: string | null
          created_at?: string
          created_by_ai?: boolean
          created_by_user_id?: string | null
          draft_body?: string
          draft_status?: string
          draft_subject?: string
          id?: string
          is_first_outreach?: boolean
          model?: string | null
          outcome?: string | null
          outcome_set_at?: string | null
          outcome_set_by?: string | null
          proposed_match_id?: string
          recipient_email_if_known?: string | null
          recipient_name?: string | null
          recipient_organisation?: string | null
          review_note?: string | null
          reviewed_by?: string | null
          send_confirmation_text?: string | null
          send_confirmed_at?: string | null
          send_confirmed_by?: string | null
          sent_at?: string | null
          sent_by_user_id?: string | null
          trade_request_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_outreach_drafts_v2_proposed_match_id_fkey"
            columns: ["proposed_match_id"]
            isOneToOne: false
            referencedRelation: "ai_proposed_matches"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_poi_intelligence_notes: {
        Row: {
          adverse_media_refs: Json
          company_announcement_refs: Json
          counterparty_name: string | null
          counterparty_org_id: string | null
          created_at: string
          created_by: string | null
          director_management_refs: Json
          escalation_reason: string | null
          escalation_required: boolean
          fraud_warning_refs: Json
          id: string
          litigation_refs: Json
          model: string | null
          poi_id: string | null
          proposed_match_id: string | null
          public_news_refs: Json
          public_web_refs: Json
          risk_flags: Json
          social_media_refs: Json
          source_classification: string | null
          source_links: Json
          source_summaries: Json
          supports_or_weakens: string | null
          trade_activity_refs: Json
          trade_request_id: string | null
          updated_at: string
        }
        Insert: {
          adverse_media_refs?: Json
          company_announcement_refs?: Json
          counterparty_name?: string | null
          counterparty_org_id?: string | null
          created_at?: string
          created_by?: string | null
          director_management_refs?: Json
          escalation_reason?: string | null
          escalation_required?: boolean
          fraud_warning_refs?: Json
          id?: string
          litigation_refs?: Json
          model?: string | null
          poi_id?: string | null
          proposed_match_id?: string | null
          public_news_refs?: Json
          public_web_refs?: Json
          risk_flags?: Json
          social_media_refs?: Json
          source_classification?: string | null
          source_links?: Json
          source_summaries?: Json
          supports_or_weakens?: string | null
          trade_activity_refs?: Json
          trade_request_id?: string | null
          updated_at?: string
        }
        Update: {
          adverse_media_refs?: Json
          company_announcement_refs?: Json
          counterparty_name?: string | null
          counterparty_org_id?: string | null
          created_at?: string
          created_by?: string | null
          director_management_refs?: Json
          escalation_reason?: string | null
          escalation_required?: boolean
          fraud_warning_refs?: Json
          id?: string
          litigation_refs?: Json
          model?: string | null
          poi_id?: string | null
          proposed_match_id?: string | null
          public_news_refs?: Json
          public_web_refs?: Json
          risk_flags?: Json
          social_media_refs?: Json
          source_classification?: string | null
          source_links?: Json
          source_summaries?: Json
          supports_or_weakens?: string | null
          trade_activity_refs?: Json
          trade_request_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_poi_intelligence_notes_proposed_match_id_fkey"
            columns: ["proposed_match_id"]
            isOneToOne: false
            referencedRelation: "ai_proposed_matches"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_proposed_matches: {
        Row: {
          approved_at: string | null
          approved_payload: Json | null
          archived_at: string | null
          assigned_reviewer_id: string | null
          capacity_indicator: string | null
          client_visible: boolean
          confidence_level: string
          confidence_override: string | null
          confidence_override_reason: string | null
          counterparty_role: string | null
          created_at: string
          created_by: string | null
          due_at: string | null
          edited_payload: Json | null
          escalation_reason: string | null
          escalation_required: boolean
          expires_at: string | null
          feedback_reason: string | null
          fit_label: string
          id: string
          interpretation_id: string | null
          jurisdiction: string | null
          match_id: string | null
          match_rationale: string | null
          original_payload: Json | null
          prior_activity_summary: string | null
          rank_position: number | null
          rejected_at: string | null
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_note: string | null
          risk_flags: Json
          sector_or_product_fit: string | null
          source_references: Json
          source_summary: string | null
          stale_at: string | null
          status: string
          suggested_counterparty_name: string
          suggested_counterparty_org_id: string | null
          trade_request_id: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_payload?: Json | null
          archived_at?: string | null
          assigned_reviewer_id?: string | null
          capacity_indicator?: string | null
          client_visible?: boolean
          confidence_level?: string
          confidence_override?: string | null
          confidence_override_reason?: string | null
          counterparty_role?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          edited_payload?: Json | null
          escalation_reason?: string | null
          escalation_required?: boolean
          expires_at?: string | null
          feedback_reason?: string | null
          fit_label?: string
          id?: string
          interpretation_id?: string | null
          jurisdiction?: string | null
          match_id?: string | null
          match_rationale?: string | null
          original_payload?: Json | null
          prior_activity_summary?: string | null
          rank_position?: number | null
          rejected_at?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_note?: string | null
          risk_flags?: Json
          sector_or_product_fit?: string | null
          source_references?: Json
          source_summary?: string | null
          stale_at?: string | null
          status?: string
          suggested_counterparty_name: string
          suggested_counterparty_org_id?: string | null
          trade_request_id: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_payload?: Json | null
          archived_at?: string | null
          assigned_reviewer_id?: string | null
          capacity_indicator?: string | null
          client_visible?: boolean
          confidence_level?: string
          confidence_override?: string | null
          confidence_override_reason?: string | null
          counterparty_role?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          edited_payload?: Json | null
          escalation_reason?: string | null
          escalation_required?: boolean
          expires_at?: string | null
          feedback_reason?: string | null
          fit_label?: string
          id?: string
          interpretation_id?: string | null
          jurisdiction?: string | null
          match_id?: string | null
          match_rationale?: string | null
          original_payload?: Json | null
          prior_activity_summary?: string | null
          rank_position?: number | null
          rejected_at?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_note?: string | null
          risk_flags?: Json
          sector_or_product_fit?: string | null
          source_references?: Json
          source_summary?: string | null
          stale_at?: string | null
          status?: string
          suggested_counterparty_name?: string
          suggested_counterparty_org_id?: string | null
          trade_request_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_proposed_matches_interpretation_id_fkey"
            columns: ["interpretation_id"]
            isOneToOne: false
            referencedRelation: "ai_trade_request_interpretations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_provider_state: {
        Row: {
          cooldown_until: string | null
          id: string
          last_error: string | null
          last_status: string | null
          last_status_code: number | null
          org_id: string
          provider: string
          retry_after_seconds: number | null
          updated_at: string
        }
        Insert: {
          cooldown_until?: string | null
          id?: string
          last_error?: string | null
          last_status?: string | null
          last_status_code?: number | null
          org_id: string
          provider?: string
          retry_after_seconds?: number | null
          updated_at?: string
        }
        Update: {
          cooldown_until?: string | null
          id?: string
          last_error?: string | null
          last_status?: string | null
          last_status_code?: number | null
          org_id?: string
          provider?: string
          retry_after_seconds?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      ai_trade_request_interpretations: {
        Row: {
          ai_confidence: string | null
          commercial_intent: string | null
          commodity_or_service: string | null
          created_at: string
          created_by: string | null
          documentation_requirements: Json
          geography: string | null
          id: string
          jurisdiction_requirements: Json
          model: string | null
          preferred_counterparty_type: string | null
          quantity: string | null
          raw_extraction: Json
          risk_indicators: Json
          side: string | null
          timing: string | null
          trade_request_id: string
          updated_at: string
        }
        Insert: {
          ai_confidence?: string | null
          commercial_intent?: string | null
          commodity_or_service?: string | null
          created_at?: string
          created_by?: string | null
          documentation_requirements?: Json
          geography?: string | null
          id?: string
          jurisdiction_requirements?: Json
          model?: string | null
          preferred_counterparty_type?: string | null
          quantity?: string | null
          raw_extraction?: Json
          risk_indicators?: Json
          side?: string | null
          timing?: string | null
          trade_request_id: string
          updated_at?: string
        }
        Update: {
          ai_confidence?: string | null
          commercial_intent?: string | null
          commodity_or_service?: string | null
          created_at?: string
          created_by?: string | null
          documentation_requirements?: Json
          geography?: string | null
          id?: string
          jurisdiction_requirements?: Json
          model?: string | null
          preferred_counterparty_type?: string | null
          quantity?: string | null
          raw_extraction?: Json
          risk_indicators?: Json
          side?: string | null
          timing?: string | null
          trade_request_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      api_active_requests: {
        Row: {
          api_client_id: string | null
          api_key_id: string
          environment: string | null
          expires_at: string
          request_id: string
          started_at: string
        }
        Insert: {
          api_client_id?: string | null
          api_key_id: string
          environment?: string | null
          expires_at?: string
          request_id: string
          started_at?: string
        }
        Update: {
          api_client_id?: string | null
          api_key_id?: string
          environment?: string | null
          expires_at?: string
          request_id?: string
          started_at?: string
        }
        Relationships: []
      }
      api_clients: {
        Row: {
          authorised_commercial_contact_email: string | null
          authorised_commercial_contact_name: string | null
          billing_contact_email: string | null
          billing_contact_name: string | null
          billing_details_confirmed: boolean
          callback_url: string | null
          commercial_plan_approved: boolean
          country: string
          created_at: string
          created_by: string | null
          expected_monthly_volume: number | null
          id: string
          intended_use_case: string | null
          ip_allowlist_or_exception_confirmed: boolean
          ip_details: string | null
          legal_entity_name: string
          notes: string | null
          org_id: string
          production_approved: boolean
          production_approved_at: string | null
          production_approved_by: string | null
          production_requested: boolean
          production_scopes_approved: boolean
          production_technical_contact_confirmed: boolean
          proposed_integration_system: string | null
          registration_number: string | null
          requested_scopes: string[]
          retention_rules_confirmed: boolean
          revoked_at: string | null
          revoked_by: string | null
          revoked_reason: string | null
          sandbox_approved: boolean
          sandbox_approved_at: string | null
          sandbox_approved_by: string | null
          sandbox_checklist_completed: boolean
          sandbox_terms_accepted: boolean
          security_contact_confirmed: boolean
          signed_api_agreement_confirmed: boolean
          status: string
          support_contact_email: string | null
          support_contact_name: string | null
          suspended_at: string | null
          suspended_by: string | null
          suspended_reason: string | null
          technical_contact_email: string | null
          technical_contact_name: string | null
          updated_at: string
        }
        Insert: {
          authorised_commercial_contact_email?: string | null
          authorised_commercial_contact_name?: string | null
          billing_contact_email?: string | null
          billing_contact_name?: string | null
          billing_details_confirmed?: boolean
          callback_url?: string | null
          commercial_plan_approved?: boolean
          country: string
          created_at?: string
          created_by?: string | null
          expected_monthly_volume?: number | null
          id?: string
          intended_use_case?: string | null
          ip_allowlist_or_exception_confirmed?: boolean
          ip_details?: string | null
          legal_entity_name: string
          notes?: string | null
          org_id: string
          production_approved?: boolean
          production_approved_at?: string | null
          production_approved_by?: string | null
          production_requested?: boolean
          production_scopes_approved?: boolean
          production_technical_contact_confirmed?: boolean
          proposed_integration_system?: string | null
          registration_number?: string | null
          requested_scopes?: string[]
          retention_rules_confirmed?: boolean
          revoked_at?: string | null
          revoked_by?: string | null
          revoked_reason?: string | null
          sandbox_approved?: boolean
          sandbox_approved_at?: string | null
          sandbox_approved_by?: string | null
          sandbox_checklist_completed?: boolean
          sandbox_terms_accepted?: boolean
          security_contact_confirmed?: boolean
          signed_api_agreement_confirmed?: boolean
          status?: string
          support_contact_email?: string | null
          support_contact_name?: string | null
          suspended_at?: string | null
          suspended_by?: string | null
          suspended_reason?: string | null
          technical_contact_email?: string | null
          technical_contact_name?: string | null
          updated_at?: string
        }
        Update: {
          authorised_commercial_contact_email?: string | null
          authorised_commercial_contact_name?: string | null
          billing_contact_email?: string | null
          billing_contact_name?: string | null
          billing_details_confirmed?: boolean
          callback_url?: string | null
          commercial_plan_approved?: boolean
          country?: string
          created_at?: string
          created_by?: string | null
          expected_monthly_volume?: number | null
          id?: string
          intended_use_case?: string | null
          ip_allowlist_or_exception_confirmed?: boolean
          ip_details?: string | null
          legal_entity_name?: string
          notes?: string | null
          org_id?: string
          production_approved?: boolean
          production_approved_at?: string | null
          production_approved_by?: string | null
          production_requested?: boolean
          production_scopes_approved?: boolean
          production_technical_contact_confirmed?: boolean
          proposed_integration_system?: string | null
          registration_number?: string | null
          requested_scopes?: string[]
          retention_rules_confirmed?: boolean
          revoked_at?: string | null
          revoked_by?: string | null
          revoked_reason?: string | null
          sandbox_approved?: boolean
          sandbox_approved_at?: string | null
          sandbox_approved_by?: string | null
          sandbox_checklist_completed?: boolean
          sandbox_terms_accepted?: boolean
          security_contact_confirmed?: boolean
          signed_api_agreement_confirmed?: boolean
          status?: string
          support_contact_email?: string | null
          support_contact_name?: string | null
          suspended_at?: string | null
          suspended_by?: string | null
          suspended_reason?: string | null
          technical_contact_email?: string | null
          technical_contact_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_clients_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_ip_allowlist_exceptions: {
        Row: {
          active: boolean
          api_client_id: string
          approved_at: string | null
          approved_by: string | null
          compensating_controls: string | null
          created_at: string
          created_by: string | null
          deactivated_at: string | null
          deactivated_by: string | null
          deactivated_reason: string | null
          id: string
          reason: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          api_client_id: string
          approved_at?: string | null
          approved_by?: string | null
          compensating_controls?: string | null
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          deactivated_reason?: string | null
          id?: string
          reason: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          api_client_id?: string
          approved_at?: string | null
          approved_by?: string | null
          compensating_controls?: string | null
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          deactivated_reason?: string | null
          id?: string
          reason?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_ip_allowlist_exceptions_api_client_id_fkey"
            columns: ["api_client_id"]
            isOneToOne: false
            referencedRelation: "api_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          allowed_ips: string[] | null
          allowed_origins: string[] | null
          api_client_id: string | null
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
          allowed_ips?: string[] | null
          allowed_origins?: string[] | null
          api_client_id?: string | null
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
          allowed_ips?: string[] | null
          allowed_origins?: string[] | null
          api_client_id?: string | null
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
            foreignKeyName: "api_keys_api_client_id_fkey"
            columns: ["api_client_id"]
            isOneToOne: false
            referencedRelation: "api_clients"
            referencedColumns: ["id"]
          },
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
          billable: boolean
          created_at: string
          endpoint: string
          environment: string | null
          error_code: string | null
          error_message: string | null
          external_reference: string | null
          id: string
          idempotency_key: string | null
          ip_address: string | null
          method: string
          org_id: string
          request_body: Json | null
          request_id: string | null
          response_body: Json | null
          response_time_ms: number
          scope_used: string | null
          status_code: number
          user_agent: string | null
        }
        Insert: {
          api_key_id?: string | null
          billable?: boolean
          created_at?: string
          endpoint: string
          environment?: string | null
          error_code?: string | null
          error_message?: string | null
          external_reference?: string | null
          id?: string
          idempotency_key?: string | null
          ip_address?: string | null
          method: string
          org_id: string
          request_body?: Json | null
          request_id?: string | null
          response_body?: Json | null
          response_time_ms: number
          scope_used?: string | null
          status_code: number
          user_agent?: string | null
        }
        Update: {
          api_key_id?: string | null
          billable?: boolean
          created_at?: string
          endpoint?: string
          environment?: string | null
          error_code?: string | null
          error_message?: string | null
          external_reference?: string | null
          id?: string
          idempotency_key?: string | null
          ip_address?: string | null
          method?: string
          org_id?: string
          request_body?: Json | null
          request_id?: string | null
          response_body?: Json | null
          response_time_ms?: number
          scope_used?: string | null
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
      api_sandbox_records: {
        Row: {
          active: boolean
          candidates: Json
          confidence_band: string | null
          country: string | null
          created_at: string
          data_freshness_date: string | null
          email_domain: string | null
          id: string
          legal_name: string | null
          match_status: string | null
          next_action: string | null
          record_scope: string
          registration_number: string | null
          risk_signal_summary: string | null
          scenario_code: string
          scenario_notes: string | null
          test_data: boolean
          trading_name: string | null
          updated_at: string
          verification_status: string | null
          website_domain: string | null
        }
        Insert: {
          active?: boolean
          candidates?: Json
          confidence_band?: string | null
          country?: string | null
          created_at?: string
          data_freshness_date?: string | null
          email_domain?: string | null
          id?: string
          legal_name?: string | null
          match_status?: string | null
          next_action?: string | null
          record_scope?: string
          registration_number?: string | null
          risk_signal_summary?: string | null
          scenario_code: string
          scenario_notes?: string | null
          test_data?: boolean
          trading_name?: string | null
          updated_at?: string
          verification_status?: string | null
          website_domain?: string | null
        }
        Update: {
          active?: boolean
          candidates?: Json
          confidence_band?: string | null
          country?: string | null
          created_at?: string
          data_freshness_date?: string | null
          email_domain?: string | null
          id?: string
          legal_name?: string | null
          match_status?: string | null
          next_action?: string | null
          record_scope?: string
          registration_number?: string | null
          risk_signal_summary?: string | null
          scenario_code?: string
          scenario_notes?: string | null
          test_data?: boolean
          trading_name?: string | null
          updated_at?: string
          verification_status?: string | null
          website_domain?: string | null
        }
        Relationships: []
      }
      api_usage_notifications_state: {
        Row: {
          api_client_id: string
          environment: string
          id: string
          notified_at: string
          period_start: string
          threshold: number
        }
        Insert: {
          api_client_id: string
          environment: string
          id?: string
          notified_at?: string
          period_start: string
          threshold: number
        }
        Update: {
          api_client_id?: string
          environment?: string
          id?: string
          notified_at?: string
          period_start?: string
          threshold?: number
        }
        Relationships: [
          {
            foreignKeyName: "api_usage_notifications_state_api_client_id_fkey"
            columns: ["api_client_id"]
            isOneToOne: false
            referencedRelation: "api_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      api_usage_overrides: {
        Row: {
          active: boolean
          api_client_id: string
          approved_at: string
          approved_by: string
          created_at: string
          environment: string
          expires_at: string
          id: string
          override_limit: number
          reason: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          api_client_id: string
          approved_at?: string
          approved_by: string
          created_at?: string
          environment: string
          expires_at: string
          id?: string
          override_limit: number
          reason: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          api_client_id?: string
          approved_at?: string
          approved_by?: string
          created_at?: string
          environment?: string
          expires_at?: string
          id?: string
          override_limit?: number
          reason?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_usage_overrides_api_client_id_fkey"
            columns: ["api_client_id"]
            isOneToOne: false
            referencedRelation: "api_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_thresholds: {
        Row: {
          created_at: string
          high_threshold: number
          id: string
          low_threshold: number
          org_id: string
          override_approved_by: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          high_threshold?: number
          id?: string
          low_threshold?: number
          org_id: string
          override_approved_by?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          high_threshold?: number
          id?: string
          low_threshold?: number
          org_id?: string
          override_approved_by?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approval_thresholds_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      attestations: {
        Row: {
          attestation_text: string
          attestation_type: string
          attester_name: string
          attester_role: string
          attester_user_id: string
          created_at: string
          id: string
          match_id: string | null
          metadata: Json | null
          org_id: string
          poi_id: string | null
          signature_hash: string
          signature_payload: string
          signed_at: string
          wad_id: string | null
        }
        Insert: {
          attestation_text: string
          attestation_type?: string
          attester_name: string
          attester_role: string
          attester_user_id: string
          created_at?: string
          id?: string
          match_id?: string | null
          metadata?: Json | null
          org_id: string
          poi_id?: string | null
          signature_hash: string
          signature_payload: string
          signed_at?: string
          wad_id?: string | null
        }
        Update: {
          attestation_text?: string
          attestation_type?: string
          attester_name?: string
          attester_role?: string
          attester_user_id?: string
          created_at?: string
          id?: string
          match_id?: string | null
          metadata?: Json | null
          org_id?: string
          poi_id?: string | null
          signature_hash?: string
          signature_payload?: string
          signed_at?: string
          wad_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attestations_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "match_evidence"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "attestations_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attestations_org_id_fkey"
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
          demo_dataset_id: string | null
          entity_id: string | null
          entity_type: string
          id: string
          is_demo: boolean
          metadata: Json | null
          org_id: string
        }
        Insert: {
          action: string
          actor_api_key_id?: string | null
          actor_user_id?: string | null
          created_at?: string
          demo_dataset_id?: string | null
          entity_id?: string | null
          entity_type: string
          id?: string
          is_demo?: boolean
          metadata?: Json | null
          org_id: string
        }
        Update: {
          action?: string
          actor_api_key_id?: string | null
          actor_user_id?: string | null
          created_at?: string
          demo_dataset_id?: string | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          is_demo?: boolean
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
      authority_records: {
        Row: {
          company_entity_id: string
          created_at: string
          document_id: string | null
          expires_at: string | null
          id: string
          method: string
          org_id: string
          person_entity_id: string
          status: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          company_entity_id: string
          created_at?: string
          document_id?: string | null
          expires_at?: string | null
          id?: string
          method: string
          org_id: string
          person_entity_id: string
          status?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          company_entity_id?: string
          created_at?: string
          document_id?: string | null
          expires_at?: string | null
          id?: string
          method?: string
          org_id?: string
          person_entity_id?: string
          status?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "authority_records_company_entity_id_fkey"
            columns: ["company_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "authority_records_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "authority_records_person_entity_id_fkey"
            columns: ["person_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      basic_memory_records: {
        Row: {
          audit_event_ids: string[]
          created_at: string
          dispute_id: string | null
          engagement_id: string | null
          environment_classification: string
          id: string
          match_id: string | null
          outcome: string
          outcome_reason: string
          outcome_summary: string | null
          poi_id: string | null
          source_function: string
          source_record_id: string
          source_table: string
          status_snapshot: Json
          trigger_event_type: string
          wad_id: string | null
        }
        Insert: {
          audit_event_ids?: string[]
          created_at?: string
          dispute_id?: string | null
          engagement_id?: string | null
          environment_classification: string
          id?: string
          match_id?: string | null
          outcome: string
          outcome_reason: string
          outcome_summary?: string | null
          poi_id?: string | null
          source_function: string
          source_record_id: string
          source_table: string
          status_snapshot?: Json
          trigger_event_type: string
          wad_id?: string | null
        }
        Update: {
          audit_event_ids?: string[]
          created_at?: string
          dispute_id?: string | null
          engagement_id?: string | null
          environment_classification?: string
          id?: string
          match_id?: string | null
          outcome?: string
          outcome_reason?: string
          outcome_summary?: string | null
          poi_id?: string | null
          source_function?: string
          source_record_id?: string
          source_table?: string
          status_snapshot?: Json
          trigger_event_type?: string
          wad_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "basic_memory_records_dispute_id_fkey"
            columns: ["dispute_id"]
            isOneToOne: false
            referencedRelation: "disputes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "basic_memory_records_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "engagement_email_sent_but_status_stuck"
            referencedColumns: ["engagement_id"]
          },
          {
            foreignKeyName: "basic_memory_records_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "poi_engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "basic_memory_records_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "match_evidence"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "basic_memory_records_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "basic_memory_records_wad_id_fkey"
            columns: ["wad_id"]
            isOneToOne: false
            referencedRelation: "wads"
            referencedColumns: ["id"]
          },
        ]
      }
      behavioral_signals: {
        Row: {
          action_type: string
          created_at: string
          id: string
          match_id: string | null
          metadata: Json | null
          org_id: string | null
          session_id: string | null
          user_id: string | null
        }
        Insert: {
          action_type: string
          created_at?: string
          id?: string
          match_id?: string | null
          metadata?: Json | null
          org_id?: string | null
          session_id?: string | null
          user_id?: string | null
        }
        Update: {
          action_type?: string
          created_at?: string
          id?: string
          match_id?: string | null
          metadata?: Json | null
          org_id?: string | null
          session_id?: string | null
          user_id?: string | null
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
          {
            foreignKeyName: "behavioral_signals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      brd_change_records: {
        Row: {
          approved_by: string | null
          constraint_key: string
          created_at: string
          id: string
          new_value: string
          old_value: string
          reason: string
          requested_by: string
          resolved_at: string | null
          status: string
        }
        Insert: {
          approved_by?: string | null
          constraint_key: string
          created_at?: string
          id?: string
          new_value: string
          old_value: string
          reason: string
          requested_by: string
          resolved_at?: string | null
          status?: string
        }
        Update: {
          approved_by?: string | null
          constraint_key?: string
          created_at?: string
          id?: string
          new_value?: string
          old_value?: string
          reason?: string
          requested_by?: string
          resolved_at?: string | null
          status?: string
        }
        Relationships: []
      }
      brd_constraints: {
        Row: {
          change_record_id: string | null
          constraint_key: string
          created_at: string
          current_value: string
          description: string
          id: string
          last_changed_at: string | null
          last_changed_by: string | null
          locked: boolean
        }
        Insert: {
          change_record_id?: string | null
          constraint_key: string
          created_at?: string
          current_value: string
          description: string
          id?: string
          last_changed_at?: string | null
          last_changed_by?: string | null
          locked?: boolean
        }
        Update: {
          change_record_id?: string | null
          constraint_key?: string
          created_at?: string
          current_value?: string
          description?: string
          id?: string
          last_changed_at?: string | null
          last_changed_by?: string | null
          locked?: boolean
        }
        Relationships: []
      }
      breaches: {
        Row: {
          detected_at: string
          escalated_at: string | null
          id: string
          milestone_id: string | null
          notification_sent_at: string | null
          org_id: string
          pod_id: string
          reason: string
          recorded_at: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          status: string
        }
        Insert: {
          detected_at?: string
          escalated_at?: string | null
          id?: string
          milestone_id?: string | null
          notification_sent_at?: string | null
          org_id: string
          pod_id: string
          reason: string
          recorded_at?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
        }
        Update: {
          detected_at?: string
          escalated_at?: string | null
          id?: string
          milestone_id?: string | null
          notification_sent_at?: string | null
          org_id?: string
          pod_id?: string
          reason?: string
          recorded_at?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "breaches_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "pod_milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "breaches_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "breaches_pod_id_fkey"
            columns: ["pod_id"]
            isOneToOne: false
            referencedRelation: "pods"
            referencedColumns: ["id"]
          },
        ]
      }
      break_glass_actions: {
        Row: {
          action_type: string
          actor_user_id: string
          created_at: string
          id: string
          metadata: Json | null
          org_id: string | null
          reason: string
          target_org_id: string | null
        }
        Insert: {
          action_type: string
          actor_user_id: string
          created_at?: string
          id?: string
          metadata?: Json | null
          org_id?: string | null
          reason: string
          target_org_id?: string | null
        }
        Update: {
          action_type?: string
          actor_user_id?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          org_id?: string | null
          reason?: string
          target_org_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "break_glass_actions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "break_glass_actions_target_org_id_fkey"
            columns: ["target_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      clip_on_billing_failures: {
        Row: {
          created_at: string
          credits_required: number | null
          current_balance: number | null
          id: string
          org_id: string
          priced_total_zar: number | null
          reason: Json | null
          request_id: string
        }
        Insert: {
          created_at?: string
          credits_required?: number | null
          current_balance?: number | null
          id?: string
          org_id: string
          priced_total_zar?: number | null
          reason?: Json | null
          request_id: string
        }
        Update: {
          created_at?: string
          credits_required?: number | null
          current_balance?: number | null
          id?: string
          org_id?: string
          priced_total_zar?: number | null
          reason?: Json | null
          request_id?: string
        }
        Relationships: []
      }
      clip_on_subscription_charges: {
        Row: {
          charged_at: string
          credits_burned: number
          id: string
          metadata: Json
          org_id: string
          period_month: string
          price_zar: number
        }
        Insert: {
          charged_at?: string
          credits_burned: number
          id?: string
          metadata?: Json
          org_id: string
          period_month: string
          price_zar: number
        }
        Update: {
          charged_at?: string
          credits_burned?: number
          id?: string
          metadata?: Json
          org_id?: string
          period_month?: string
          price_zar?: number
        }
        Relationships: [
          {
            foreignKeyName: "clip_on_subscription_charges_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      collapse_ledger: {
        Row: {
          actor_user_id: string | null
          annulment_reference: string | null
          asset_id: string
          client_timestamp: string
          counterparty_org_id: string
          created_at: string
          currency: string
          id: string
          idempotency_key: string
          match_id: string | null
          metadata: Json | null
          ntp_drift_ms: number | null
          ntp_source: string | null
          org_id: string
          payload_ciphertext: string | null
          payload_hash: string
          poi_state: string
          price: number
          quantity: number
          signature_key_id: string | null
          signature_valid: boolean
          signed_payload: string
          timestamp_source_metadata: Json | null
        }
        Insert: {
          actor_user_id?: string | null
          annulment_reference?: string | null
          asset_id: string
          client_timestamp: string
          counterparty_org_id: string
          created_at?: string
          currency: string
          id?: string
          idempotency_key: string
          match_id?: string | null
          metadata?: Json | null
          ntp_drift_ms?: number | null
          ntp_source?: string | null
          org_id: string
          payload_ciphertext?: string | null
          payload_hash: string
          poi_state?: string
          price: number
          quantity: number
          signature_key_id?: string | null
          signature_valid?: boolean
          signed_payload: string
          timestamp_source_metadata?: Json | null
        }
        Update: {
          actor_user_id?: string | null
          annulment_reference?: string | null
          asset_id?: string
          client_timestamp?: string
          counterparty_org_id?: string
          created_at?: string
          currency?: string
          id?: string
          idempotency_key?: string
          match_id?: string | null
          metadata?: Json | null
          ntp_drift_ms?: number | null
          ntp_source?: string | null
          org_id?: string
          payload_ciphertext?: string | null
          payload_hash?: string
          poi_state?: string
          price?: number
          quantity?: number
          signature_key_id?: string | null
          signature_valid?: boolean
          signed_payload?: string
          timestamp_source_metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "collapse_ledger_counterparty_org_id_fkey"
            columns: ["counterparty_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collapse_ledger_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "match_evidence"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "collapse_ledger_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collapse_ledger_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_cases: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_notes: string | null
          demo_dataset_id: string | null
          entity_id: string
          id: string
          is_demo: boolean
          org_id: string
          status: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_notes?: string | null
          demo_dataset_id?: string | null
          entity_id: string
          id?: string
          is_demo?: boolean
          org_id: string
          status?: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_notes?: string | null
          demo_dataset_id?: string | null
          entity_id?: string
          id?: string
          is_demo?: boolean
          org_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_cases_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_cases_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_holds: {
        Row: {
          created_at: string
          demo_dataset_id: string | null
          entity_id: string | null
          hold_type: string
          id: string
          is_demo: boolean
          metadata: Json
          opened_at: string
          opened_by: string | null
          org_id: string
          reason: string
          release_reason: string | null
          released_at: string | null
          released_by: string | null
          source_check_id: string | null
          source_check_type: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          demo_dataset_id?: string | null
          entity_id?: string | null
          hold_type: string
          id?: string
          is_demo?: boolean
          metadata?: Json
          opened_at?: string
          opened_by?: string | null
          org_id: string
          reason: string
          release_reason?: string | null
          released_at?: string | null
          released_by?: string | null
          source_check_id?: string | null
          source_check_type?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          demo_dataset_id?: string | null
          entity_id?: string | null
          hold_type?: string
          id?: string
          is_demo?: boolean
          metadata?: Json
          opened_at?: string
          opened_by?: string | null
          org_id?: string
          reason?: string
          release_reason?: string | null
          released_at?: string | null
          released_by?: string | null
          source_check_id?: string | null
          source_check_type?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_holds_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_holds_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
            referencedRelation: "account_hard_delete_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "consents_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "org_colleagues_v"
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
            foreignKeyName: "consents_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles_safe"
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
      counterparties: {
        Row: {
          canonical_key: string | null
          company_name: string
          contact_email: string | null
          created_at: string
          description: string | null
          fts: unknown
          id: string
          jurisdiction: string | null
          linked_org_id: string | null
          merged_at: string | null
          merged_by: string | null
          merged_into_id: string | null
          merged_reason: string | null
          org_id: string
          product_categories: string[] | null
          registration_number: string | null
          updated_at: string
          verified: boolean
          website: string | null
        }
        Insert: {
          canonical_key?: string | null
          company_name: string
          contact_email?: string | null
          created_at?: string
          description?: string | null
          fts?: unknown
          id?: string
          jurisdiction?: string | null
          linked_org_id?: string | null
          merged_at?: string | null
          merged_by?: string | null
          merged_into_id?: string | null
          merged_reason?: string | null
          org_id: string
          product_categories?: string[] | null
          registration_number?: string | null
          updated_at?: string
          verified?: boolean
          website?: string | null
        }
        Update: {
          canonical_key?: string | null
          company_name?: string
          contact_email?: string | null
          created_at?: string
          description?: string | null
          fts?: unknown
          id?: string
          jurisdiction?: string | null
          linked_org_id?: string | null
          merged_at?: string | null
          merged_by?: string | null
          merged_into_id?: string | null
          merged_reason?: string | null
          org_id?: string
          product_categories?: string[] | null
          registration_number?: string | null
          updated_at?: string
          verified?: boolean
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "counterparties_linked_org_id_fkey"
            columns: ["linked_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "counterparties_merged_into_id_fkey"
            columns: ["merged_into_id"]
            isOneToOne: false
            referencedRelation: "counterparties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "counterparties_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      counterparty_ratings: {
        Row: {
          band: string
          compliance_score: number | null
          computed_at: string
          created_at: string
          id: string
          methodology_version: number
          next_recompute_at: string | null
          org_id: string
          overall_score: number | null
          recent_sample_size: number
          reliability_score: number | null
          responsiveness_score: number | null
          sample_size: number
          settlement_score: number | null
          signals_summary: Json
          updated_at: string
        }
        Insert: {
          band?: string
          compliance_score?: number | null
          computed_at?: string
          created_at?: string
          id?: string
          methodology_version: number
          next_recompute_at?: string | null
          org_id: string
          overall_score?: number | null
          recent_sample_size?: number
          reliability_score?: number | null
          responsiveness_score?: number | null
          sample_size?: number
          settlement_score?: number | null
          signals_summary?: Json
          updated_at?: string
        }
        Update: {
          band?: string
          compliance_score?: number | null
          computed_at?: string
          created_at?: string
          id?: string
          methodology_version?: number
          next_recompute_at?: string | null
          org_id?: string
          overall_score?: number | null
          recent_sample_size?: number
          reliability_score?: number | null
          responsiveness_score?: number | null
          sample_size?: number
          settlement_score?: number | null
          signals_summary?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "counterparty_ratings_methodology_version_fkey"
            columns: ["methodology_version"]
            isOneToOne: false
            referencedRelation: "rating_methodology_versions"
            referencedColumns: ["version"]
          },
          {
            foreignKeyName: "counterparty_ratings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cron_heartbeats: {
        Row: {
          expected_interval_seconds: number
          job_name: string
          last_error: string | null
          last_http_status: number | null
          last_request_id: number | null
          last_run_at: string | null
          last_status: string
          updated_at: string
        }
        Insert: {
          expected_interval_seconds?: number
          job_name: string
          last_error?: string | null
          last_http_status?: number | null
          last_request_id?: number | null
          last_run_at?: string | null
          last_status?: string
          updated_at?: string
        }
        Update: {
          expected_interval_seconds?: number
          job_name?: string
          last_error?: string | null
          last_http_status?: number | null
          last_request_id?: number | null
          last_run_at?: string | null
          last_status?: string
          updated_at?: string
        }
        Relationships: []
      }
      data_residency_reviews: {
        Row: {
          created_at: string
          decision_reason: string | null
          expires_at: string | null
          id: string
          legal_basis: string | null
          metadata: Json
          org_id: string
          requested_country: string | null
          requested_region: string | null
          requirement_source: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          decision_reason?: string | null
          expires_at?: string | null
          id?: string
          legal_basis?: string | null
          metadata?: Json
          org_id: string
          requested_country?: string | null
          requested_region?: string | null
          requirement_source: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          decision_reason?: string | null
          expires_at?: string | null
          id?: string
          legal_basis?: string | null
          metadata?: Json
          org_id?: string
          requested_country?: string | null
          requested_region?: string | null
          requirement_source?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_residency_reviews_org_id_fkey"
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
            referencedRelation: "account_hard_delete_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "data_source_registrations_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "org_colleagues_v"
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
            foreignKeyName: "data_source_registrations_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_source_registrations_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "account_hard_delete_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "data_source_registrations_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "org_colleagues_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_source_registrations_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_source_registrations_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles_safe"
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
      dd_approval_actions: {
        Row: {
          action: string
          actor_role: string
          actor_user_id: string
          approval_request_id: string
          created_at: string
          id: string
          reason: string | null
        }
        Insert: {
          action: string
          actor_role: string
          actor_user_id: string
          approval_request_id: string
          created_at?: string
          id?: string
          reason?: string | null
        }
        Update: {
          action?: string
          actor_role?: string
          actor_user_id?: string
          approval_request_id?: string
          created_at?: string
          id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dd_approval_actions_approval_request_id_fkey"
            columns: ["approval_request_id"]
            isOneToOne: false
            referencedRelation: "dd_approval_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      dd_approval_requests: {
        Row: {
          completed_roles: string[]
          created_at: string
          dedup_key: string | null
          demo_dataset_id: string | null
          id: string
          is_demo: boolean
          kind: string | null
          metadata: Json
          reason: string | null
          requesting_org_id: string
          required_roles: string[]
          risk_score_id: string | null
          status: string
          target_org_id: string
          updated_at: string
        }
        Insert: {
          completed_roles?: string[]
          created_at?: string
          dedup_key?: string | null
          demo_dataset_id?: string | null
          id?: string
          is_demo?: boolean
          kind?: string | null
          metadata?: Json
          reason?: string | null
          requesting_org_id: string
          required_roles?: string[]
          risk_score_id?: string | null
          status?: string
          target_org_id: string
          updated_at?: string
        }
        Update: {
          completed_roles?: string[]
          created_at?: string
          dedup_key?: string | null
          demo_dataset_id?: string | null
          id?: string
          is_demo?: boolean
          kind?: string | null
          metadata?: Json
          reason?: string | null
          requesting_org_id?: string
          required_roles?: string[]
          risk_score_id?: string | null
          status?: string
          target_org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dd_approval_requests_requesting_org_id_fkey"
            columns: ["requesting_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dd_approval_requests_risk_score_id_fkey"
            columns: ["risk_score_id"]
            isOneToOne: false
            referencedRelation: "dd_risk_scores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dd_approval_requests_target_org_id_fkey"
            columns: ["target_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dd_risk_scores: {
        Row: {
          computed_at: string
          computed_by: string | null
          created_at: string
          factors: Json
          id: string
          org_id: string
          risk_band: string
          score: number
          weights: Json
        }
        Insert: {
          computed_at?: string
          computed_by?: string | null
          created_at?: string
          factors?: Json
          id?: string
          org_id: string
          risk_band?: string
          score?: number
          weights?: Json
        }
        Update: {
          computed_at?: string
          computed_by?: string | null
          created_at?: string
          factors?: Json
          id?: string
          org_id?: string
          risk_band?: string
          score?: number
          weights?: Json
        }
        Relationships: [
          {
            foreignKeyName: "dd_risk_scores_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dd_roles: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dd_roles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_terms: {
        Row: {
          amendment_notes: string | null
          created_at: string | null
          delivery_terms: string | null
          id: string
          inspection_terms: string | null
          match_id: string
          org_id: string
          partial_shipment: boolean | null
          payment_terms: string | null
          penalty_terms: string | null
          proposed_by: string | null
          status: string | null
          version: number | null
        }
        Insert: {
          amendment_notes?: string | null
          created_at?: string | null
          delivery_terms?: string | null
          id?: string
          inspection_terms?: string | null
          match_id: string
          org_id: string
          partial_shipment?: boolean | null
          payment_terms?: string | null
          penalty_terms?: string | null
          proposed_by?: string | null
          status?: string | null
          version?: number | null
        }
        Update: {
          amendment_notes?: string | null
          created_at?: string | null
          delivery_terms?: string | null
          id?: string
          inspection_terms?: string | null
          match_id?: string
          org_id?: string
          partial_shipment?: boolean | null
          payment_terms?: string | null
          penalty_terms?: string | null
          proposed_by?: string | null
          status?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "deal_terms_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "match_evidence"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "deal_terms_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_terms_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_workspaces: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          dataset_id: string
          id: string
          last_reset_by: string | null
          metadata: Json
          notes: string | null
          org_id: string
          reset_at: string | null
          status: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          dataset_id: string
          id?: string
          last_reset_by?: string | null
          metadata?: Json
          notes?: string | null
          org_id: string
          reset_at?: string | null
          status?: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          dataset_id?: string
          id?: string
          last_reset_by?: string | null
          metadata?: Json
          notes?: string | null
          org_id?: string
          reset_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "demo_workspaces_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      discovery_search_logs: {
        Row: {
          created_at: string
          fts_result_count: number
          id: string
          ilike_fallback_used: boolean
          ilike_result_count: number
          order_book_result_count: number
          org_id: string
          parse_token_count: number
          parsed_location: string | null
          parsed_product: string | null
          parsed_role: string | null
          raw_query: string
          request_id: string
          response_time_ms: number | null
          search_method: string
          total_results_returned: number
        }
        Insert: {
          created_at?: string
          fts_result_count?: number
          id?: string
          ilike_fallback_used?: boolean
          ilike_result_count?: number
          order_book_result_count?: number
          org_id: string
          parse_token_count?: number
          parsed_location?: string | null
          parsed_product?: string | null
          parsed_role?: string | null
          raw_query: string
          request_id: string
          response_time_ms?: number | null
          search_method?: string
          total_results_returned?: number
        }
        Update: {
          created_at?: string
          fts_result_count?: number
          id?: string
          ilike_fallback_used?: boolean
          ilike_result_count?: number
          order_book_result_count?: number
          org_id?: string
          parse_token_count?: number
          parsed_location?: string | null
          parsed_product?: string | null
          parsed_role?: string | null
          raw_query?: string
          request_id?: string
          response_time_ms?: number | null
          search_method?: string
          total_results_returned?: number
        }
        Relationships: [
          {
            foreignKeyName: "discovery_search_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      disputed_credit_holds: {
        Row: {
          admin_risk_item_id: string | null
          created_at: string
          credits_held: number
          dispute_reference: string
          id: string
          metadata: Json
          opened_at: string
          org_id: string
          payment_reference: string
          price_usd: number | null
          reminded_at: string | null
          resolution_reason: string | null
          resolved_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          admin_risk_item_id?: string | null
          created_at?: string
          credits_held: number
          dispute_reference: string
          id?: string
          metadata?: Json
          opened_at?: string
          org_id: string
          payment_reference: string
          price_usd?: number | null
          reminded_at?: string | null
          resolution_reason?: string | null
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          admin_risk_item_id?: string | null
          created_at?: string
          credits_held?: number
          dispute_reference?: string
          id?: string
          metadata?: Json
          opened_at?: string
          org_id?: string
          payment_reference?: string
          price_usd?: number | null
          reminded_at?: string | null
          resolution_reason?: string | null
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "disputed_credit_holds_admin_risk_item_id_fkey"
            columns: ["admin_risk_item_id"]
            isOneToOne: false
            referencedRelation: "admin_risk_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputed_credit_holds_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      disputes: {
        Row: {
          created_at: string | null
          evidence_notes: string | null
          id: string
          match_id: string
          raised_by_org_id: string
          raised_by_user_id: string
          reason: string
          resolution_outcome: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          evidence_notes?: string | null
          id?: string
          match_id: string
          raised_by_org_id: string
          raised_by_user_id: string
          reason: string
          resolution_outcome?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          evidence_notes?: string | null
          id?: string
          match_id?: string
          raised_by_org_id?: string
          raised_by_user_id?: string
          reason?: string
          resolution_outcome?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "disputes_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "match_evidence"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "disputes_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_raised_by_org_id_fkey"
            columns: ["raised_by_org_id"]
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
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          idempotency_key: string | null
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          last_error: string | null
          last_error_at: string | null
          last_run_at: string | null
          last_success_at: string | null
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          last_error?: string | null
          last_error_at?: string | null
          last_run_at?: string | null
          last_success_at?: string | null
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          last_error?: string | null
          last_error_at?: string | null
          last_run_at?: string | null
          last_success_at?: string | null
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      engagement_outreach_drafts: {
        Row: {
          ai_confidence: string | null
          approved_at: string | null
          approved_by: string | null
          context_summary: string | null
          created_at: string
          created_by: string | null
          draft_body: string
          draft_subject: string
          engagement_id: string
          id: string
          model: string | null
          org_id: string
          regenerated_from: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          ai_confidence?: string | null
          approved_at?: string | null
          approved_by?: string | null
          context_summary?: string | null
          created_at?: string
          created_by?: string | null
          draft_body: string
          draft_subject: string
          engagement_id: string
          id?: string
          model?: string | null
          org_id: string
          regenerated_from?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          ai_confidence?: string | null
          approved_at?: string | null
          approved_by?: string | null
          context_summary?: string | null
          created_at?: string
          created_by?: string | null
          draft_body?: string
          draft_subject?: string
          engagement_id?: string
          id?: string
          model?: string | null
          org_id?: string
          regenerated_from?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "engagement_outreach_drafts_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "engagement_email_sent_but_status_stuck"
            referencedColumns: ["engagement_id"]
          },
          {
            foreignKeyName: "engagement_outreach_drafts_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "poi_engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_outreach_drafts_regenerated_from_fkey"
            columns: ["regenerated_from"]
            isOneToOne: false
            referencedRelation: "engagement_outreach_drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      engagement_outreach_logs: {
        Row: {
          actor_type: string
          admin_email: string | null
          admin_name: string | null
          admin_user_id: string | null
          contact_detail: string | null
          contact_method: string | null
          created_at: string
          demo_dataset_id: string | null
          engagement_id: string
          entry_type: string
          id: string
          is_demo: boolean
          new_status: string
          notes: string | null
          previous_status: string
        }
        Insert: {
          actor_type?: string
          admin_email?: string | null
          admin_name?: string | null
          admin_user_id?: string | null
          contact_detail?: string | null
          contact_method?: string | null
          created_at?: string
          demo_dataset_id?: string | null
          engagement_id: string
          entry_type?: string
          id?: string
          is_demo?: boolean
          new_status: string
          notes?: string | null
          previous_status: string
        }
        Update: {
          actor_type?: string
          admin_email?: string | null
          admin_name?: string | null
          admin_user_id?: string | null
          contact_detail?: string | null
          contact_method?: string | null
          created_at?: string
          demo_dataset_id?: string | null
          engagement_id?: string
          entry_type?: string
          id?: string
          is_demo?: boolean
          new_status?: string
          notes?: string | null
          previous_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "engagement_outreach_logs_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "engagement_email_sent_but_status_stuck"
            referencedColumns: ["engagement_id"]
          },
          {
            foreignKeyName: "engagement_outreach_logs_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "poi_engagements"
            referencedColumns: ["id"]
          },
        ]
      }
      entities: {
        Row: {
          created_at: string
          entity_type: string
          id: string
          jurisdiction_code: string
          legal_name: string
          metadata: Json
          org_id: string
          registration_number: string | null
          status: string
          tax_number: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          entity_type: string
          id?: string
          jurisdiction_code: string
          legal_name: string
          metadata?: Json
          org_id: string
          registration_number?: string | null
          status?: string
          tax_number?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          entity_type?: string
          id?: string
          jurisdiction_code?: string
          legal_name?: string
          metadata?: Json
          org_id?: string
          registration_number?: string | null
          status?: string
          tax_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "entities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      event_store: {
        Row: {
          actor_id: string | null
          actor_role: string | null
          aggregate_id: string
          aggregate_type: string
          domain: string
          event_hash: string
          event_type: string
          event_version: number
          id: string
          occurred_at: string
          org_id: string
          payload: Json
          prev_hash: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_role?: string | null
          aggregate_id: string
          aggregate_type: string
          domain: string
          event_hash: string
          event_type: string
          event_version?: number
          id?: string
          occurred_at?: string
          org_id: string
          payload?: Json
          prev_hash?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_role?: string | null
          aggregate_id?: string
          aggregate_type?: string
          domain?: string
          event_hash?: string
          event_type?: string
          event_version?: number
          id?: string
          occurred_at?: string
          org_id?: string
          payload?: Json
          prev_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_store_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      export_files: {
        Row: {
          byte_size: number
          created_at: string
          destroy_reason: string | null
          destroyed_at: string | null
          downloads: Json
          expires_at: string
          export_request_id: string
          format: string
          generated_at: string
          id: string
          row_counts: Json
          sha256: string
          storage_bucket: string
          storage_path: string
          updated_at: string
        }
        Insert: {
          byte_size: number
          created_at?: string
          destroy_reason?: string | null
          destroyed_at?: string | null
          downloads?: Json
          expires_at: string
          export_request_id: string
          format: string
          generated_at?: string
          id?: string
          row_counts?: Json
          sha256: string
          storage_bucket: string
          storage_path: string
          updated_at?: string
        }
        Update: {
          byte_size?: number
          created_at?: string
          destroy_reason?: string | null
          destroyed_at?: string | null
          downloads?: Json
          expires_at?: string
          export_request_id?: string
          format?: string
          generated_at?: string
          id?: string
          row_counts?: Json
          sha256?: string
          storage_bucket?: string
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "export_files_export_request_id_fkey"
            columns: ["export_request_id"]
            isOneToOne: false
            referencedRelation: "export_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      export_jobs: {
        Row: {
          attempts: number
          created_at: string
          export_request_id: string
          finished_at: string | null
          id: string
          job_kind: string
          last_error: string | null
          scheduled_for: string
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          export_request_id: string
          finished_at?: string | null
          id?: string
          job_kind: string
          last_error?: string | null
          scheduled_for?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          export_request_id?: string
          finished_at?: string | null
          id?: string
          job_kind?: string
          last_error?: string | null
          scheduled_for?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "export_jobs_export_request_id_fkey"
            columns: ["export_request_id"]
            isOneToOne: false
            referencedRelation: "export_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      export_requests: {
        Row: {
          approval: Json
          block_reason: string | null
          created_at: string
          date_range: Json | null
          expires_at: string | null
          governance_record_id: string | null
          id: string
          kind: string
          purpose: string | null
          reason: string | null
          redaction_mode: string | null
          requested_at: string
          requested_categories: string[]
          requester_user_id: string
          resolved_categories: string[]
          status: string
          subject_user_id: string | null
          target_org_id: string | null
          updated_at: string
          verification: Json
        }
        Insert: {
          approval?: Json
          block_reason?: string | null
          created_at?: string
          date_range?: Json | null
          expires_at?: string | null
          governance_record_id?: string | null
          id?: string
          kind: string
          purpose?: string | null
          reason?: string | null
          redaction_mode?: string | null
          requested_at?: string
          requested_categories?: string[]
          requester_user_id: string
          resolved_categories?: string[]
          status: string
          subject_user_id?: string | null
          target_org_id?: string | null
          updated_at?: string
          verification?: Json
        }
        Update: {
          approval?: Json
          block_reason?: string | null
          created_at?: string
          date_range?: Json | null
          expires_at?: string | null
          governance_record_id?: string | null
          id?: string
          kind?: string
          purpose?: string | null
          reason?: string | null
          redaction_mode?: string | null
          requested_at?: string
          requested_categories?: string[]
          requester_user_id?: string
          resolved_categories?: string[]
          status?: string
          subject_user_id?: string | null
          target_org_id?: string | null
          updated_at?: string
          verification?: Json
        }
        Relationships: []
      }
      facilitation_case_contact_attempts: {
        Row: {
          actor_user_id: string
          case_id: string
          channel: string
          contact_at: string
          contact_details_used: string | null
          created_at: string
          evidence_summary: string | null
          id: string
          next_action_date: string | null
          note: string | null
          recipient: string | null
          result: string
        }
        Insert: {
          actor_user_id: string
          case_id: string
          channel: string
          contact_at: string
          contact_details_used?: string | null
          created_at?: string
          evidence_summary?: string | null
          id?: string
          next_action_date?: string | null
          note?: string | null
          recipient?: string | null
          result: string
        }
        Update: {
          actor_user_id?: string
          case_id?: string
          channel?: string
          contact_at?: string
          contact_details_used?: string | null
          created_at?: string
          evidence_summary?: string | null
          id?: string
          next_action_date?: string | null
          note?: string | null
          recipient?: string | null
          result?: string
        }
        Relationships: [
          {
            foreignKeyName: "facilitation_case_contact_attempts_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "facilitation_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      facilitation_case_events: {
        Row: {
          action: string
          actor_user_id: string | null
          case_id: string
          created_at: string
          from_status: string | null
          id: string
          payload: Json
          to_status: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          case_id: string
          created_at?: string
          from_status?: string | null
          id?: string
          payload?: Json
          to_status?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          case_id?: string
          created_at?: string
          from_status?: string | null
          id?: string
          payload?: Json
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facilitation_case_events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "facilitation_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      facilitation_case_evidence: {
        Row: {
          case_id: string
          created_at: string
          id: string
          mime_type: string | null
          original_filename: string
          size_bytes: number | null
          storage_path: string
          uploaded_by: string
        }
        Insert: {
          case_id: string
          created_at?: string
          id?: string
          mime_type?: string | null
          original_filename: string
          size_bytes?: number | null
          storage_path: string
          uploaded_by: string
        }
        Update: {
          case_id?: string
          created_at?: string
          id?: string
          mime_type?: string | null
          original_filename?: string
          size_bytes?: number | null
          storage_path?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "facilitation_case_evidence_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "facilitation_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      facilitation_case_next_steps: {
        Row: {
          assigned_to: string | null
          case_id: string
          completed_at: string | null
          completed_by: string | null
          completion_note: string | null
          created_at: string
          created_by: string
          description: string
          id: string
          next_step_type: string
          related_match_id: string | null
          related_organization_id: string | null
          related_trade_request_id: string | null
          required_actions: Json
          status: string
          title: string
          trigger_event_id: string | null
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          case_id: string
          completed_at?: string | null
          completed_by?: string | null
          completion_note?: string | null
          created_at?: string
          created_by: string
          description: string
          id?: string
          next_step_type: string
          related_match_id?: string | null
          related_organization_id?: string | null
          related_trade_request_id?: string | null
          required_actions?: Json
          status?: string
          title: string
          trigger_event_id?: string | null
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          case_id?: string
          completed_at?: string | null
          completed_by?: string | null
          completion_note?: string | null
          created_at?: string
          created_by?: string
          description?: string
          id?: string
          next_step_type?: string
          related_match_id?: string | null
          related_organization_id?: string | null
          related_trade_request_id?: string | null
          required_actions?: Json
          status?: string
          title?: string
          trigger_event_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "facilitation_case_next_steps_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "facilitation_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      facilitation_case_registry_checks: {
        Row: {
          actor_user_id: string
          case_id: string
          confidence: string
          created_at: string
          evidence_summary: string | null
          id: string
          lookup_date: string
          note: string | null
          provider_name: string
          result: string
          source_reference: string | null
        }
        Insert: {
          actor_user_id: string
          case_id: string
          confidence: string
          created_at?: string
          evidence_summary?: string | null
          id?: string
          lookup_date: string
          note?: string | null
          provider_name: string
          result: string
          source_reference?: string | null
        }
        Update: {
          actor_user_id?: string
          case_id?: string
          confidence?: string
          created_at?: string
          evidence_summary?: string | null
          id?: string
          lookup_date?: string
          note?: string | null
          provider_name?: string
          result?: string
          source_reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facilitation_case_registry_checks_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "facilitation_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      facilitation_case_sanctions_checks: {
        Row: {
          actor_user_id: string
          case_id: string
          compliance_decision: string
          created_at: string
          evidence_summary: string | null
          id: string
          matched_name: string | null
          note: string | null
          result: string
          risk_level: string
          screening_date: string
          screening_source: string
        }
        Insert: {
          actor_user_id: string
          case_id: string
          compliance_decision: string
          created_at?: string
          evidence_summary?: string | null
          id?: string
          matched_name?: string | null
          note?: string | null
          result: string
          risk_level: string
          screening_date: string
          screening_source: string
        }
        Update: {
          actor_user_id?: string
          case_id?: string
          compliance_decision?: string
          created_at?: string
          evidence_summary?: string | null
          id?: string
          matched_name?: string | null
          note?: string | null
          result?: string
          risk_level?: string
          screening_date?: string
          screening_source?: string
        }
        Relationships: [
          {
            foreignKeyName: "facilitation_case_sanctions_checks_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "facilitation_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      facilitation_case_sla_reminders: {
        Row: {
          case_id: string
          id: string
          reason_code: string
          sent_at: string
          sent_to_user_id: string
        }
        Insert: {
          case_id: string
          id?: string
          reason_code: string
          sent_at?: string
          sent_to_user_id: string
        }
        Update: {
          case_id?: string
          id?: string
          reason_code?: string
          sent_at?: string
          sent_to_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "facilitation_case_sla_reminders_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "facilitation_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      facilitation_cases: {
        Row: {
          case_number: string
          case_owner_id: string | null
          closed_at: string | null
          closing_reason: string | null
          compliance_review_due_at: string | null
          contact_person_email: string | null
          contact_person_phone: string | null
          contact_person_title: string | null
          counterparty_city: string | null
          counterparty_contact_name: string | null
          counterparty_country: string
          counterparty_email: string | null
          counterparty_legal_name: string
          counterparty_phone: string | null
          counterparty_trading_name: string | null
          counterparty_website: string | null
          created_at: string
          estimated_value_amount: number
          estimated_value_currency: string
          final_outcome: string | null
          first_outreach_due_at: string | null
          follow_up_outreach_due_at: string | null
          how_user_knows_counterparty: string
          how_user_knows_notes: string | null
          id: string
          info_request_due_date: string | null
          info_request_items: string[] | null
          info_request_message: string | null
          info_request_requested_at: string | null
          info_request_requested_by: string | null
          info_request_response_at: string | null
          info_request_response_evidence_summary: string | null
          info_request_response_message: string | null
          initial_triage_due_at: string | null
          internal_status: string
          is_overdue: boolean
          last_activity_at: string | null
          linked_organization_evidence_summary: string | null
          linked_organization_id: string | null
          linked_organization_linked_at: string | null
          linked_organization_linked_by: string | null
          linked_organization_reason: string | null
          more_info_response_due_at: string | null
          next_action_due_at: string | null
          overdue_reasons: string[]
          owner_assignment_due_at: string | null
          permission_to_contact: boolean
          physical_address: string | null
          poi_conversion_evidence_summary: string | null
          poi_conversion_reason: string | null
          poi_conversion_recorded_at: string | null
          poi_conversion_recorded_by: string | null
          poi_conversion_reference: string | null
          poi_engagement_id: string | null
          preferred_contact_language: string | null
          product_or_commodity: string
          profile_record_evidence_summary: string | null
          profile_record_note: string | null
          profile_record_recorded_at: string | null
          profile_record_recorded_by: string | null
          profile_record_reference: string | null
          ready_for_poi_at: string | null
          ready_for_poi_authority_summary: string | null
          ready_for_poi_by: string | null
          reason: string
          registration_number: string | null
          relationship_status: string | null
          requesting_org_id: string
          requesting_user_id: string
          role: string
          sector: string | null
          sla_last_evaluated_at: string | null
          source_evidence_summary: string | null
          target_response_date: string | null
          tax_vat_number: string | null
          trade_request_id: string
          updated_at: string
          urgency: string
          user_declaration_accepted: boolean
          user_declaration_accepted_at: string
          user_facing_status: string
        }
        Insert: {
          case_number: string
          case_owner_id?: string | null
          closed_at?: string | null
          closing_reason?: string | null
          compliance_review_due_at?: string | null
          contact_person_email?: string | null
          contact_person_phone?: string | null
          contact_person_title?: string | null
          counterparty_city?: string | null
          counterparty_contact_name?: string | null
          counterparty_country: string
          counterparty_email?: string | null
          counterparty_legal_name: string
          counterparty_phone?: string | null
          counterparty_trading_name?: string | null
          counterparty_website?: string | null
          created_at?: string
          estimated_value_amount: number
          estimated_value_currency: string
          final_outcome?: string | null
          first_outreach_due_at?: string | null
          follow_up_outreach_due_at?: string | null
          how_user_knows_counterparty: string
          how_user_knows_notes?: string | null
          id?: string
          info_request_due_date?: string | null
          info_request_items?: string[] | null
          info_request_message?: string | null
          info_request_requested_at?: string | null
          info_request_requested_by?: string | null
          info_request_response_at?: string | null
          info_request_response_evidence_summary?: string | null
          info_request_response_message?: string | null
          initial_triage_due_at?: string | null
          internal_status?: string
          is_overdue?: boolean
          last_activity_at?: string | null
          linked_organization_evidence_summary?: string | null
          linked_organization_id?: string | null
          linked_organization_linked_at?: string | null
          linked_organization_linked_by?: string | null
          linked_organization_reason?: string | null
          more_info_response_due_at?: string | null
          next_action_due_at?: string | null
          overdue_reasons?: string[]
          owner_assignment_due_at?: string | null
          permission_to_contact: boolean
          physical_address?: string | null
          poi_conversion_evidence_summary?: string | null
          poi_conversion_reason?: string | null
          poi_conversion_recorded_at?: string | null
          poi_conversion_recorded_by?: string | null
          poi_conversion_reference?: string | null
          poi_engagement_id?: string | null
          preferred_contact_language?: string | null
          product_or_commodity: string
          profile_record_evidence_summary?: string | null
          profile_record_note?: string | null
          profile_record_recorded_at?: string | null
          profile_record_recorded_by?: string | null
          profile_record_reference?: string | null
          ready_for_poi_at?: string | null
          ready_for_poi_authority_summary?: string | null
          ready_for_poi_by?: string | null
          reason: string
          registration_number?: string | null
          relationship_status?: string | null
          requesting_org_id: string
          requesting_user_id: string
          role: string
          sector?: string | null
          sla_last_evaluated_at?: string | null
          source_evidence_summary?: string | null
          target_response_date?: string | null
          tax_vat_number?: string | null
          trade_request_id: string
          updated_at?: string
          urgency: string
          user_declaration_accepted: boolean
          user_declaration_accepted_at?: string
          user_facing_status?: string
        }
        Update: {
          case_number?: string
          case_owner_id?: string | null
          closed_at?: string | null
          closing_reason?: string | null
          compliance_review_due_at?: string | null
          contact_person_email?: string | null
          contact_person_phone?: string | null
          contact_person_title?: string | null
          counterparty_city?: string | null
          counterparty_contact_name?: string | null
          counterparty_country?: string
          counterparty_email?: string | null
          counterparty_legal_name?: string
          counterparty_phone?: string | null
          counterparty_trading_name?: string | null
          counterparty_website?: string | null
          created_at?: string
          estimated_value_amount?: number
          estimated_value_currency?: string
          final_outcome?: string | null
          first_outreach_due_at?: string | null
          follow_up_outreach_due_at?: string | null
          how_user_knows_counterparty?: string
          how_user_knows_notes?: string | null
          id?: string
          info_request_due_date?: string | null
          info_request_items?: string[] | null
          info_request_message?: string | null
          info_request_requested_at?: string | null
          info_request_requested_by?: string | null
          info_request_response_at?: string | null
          info_request_response_evidence_summary?: string | null
          info_request_response_message?: string | null
          initial_triage_due_at?: string | null
          internal_status?: string
          is_overdue?: boolean
          last_activity_at?: string | null
          linked_organization_evidence_summary?: string | null
          linked_organization_id?: string | null
          linked_organization_linked_at?: string | null
          linked_organization_linked_by?: string | null
          linked_organization_reason?: string | null
          more_info_response_due_at?: string | null
          next_action_due_at?: string | null
          overdue_reasons?: string[]
          owner_assignment_due_at?: string | null
          permission_to_contact?: boolean
          physical_address?: string | null
          poi_conversion_evidence_summary?: string | null
          poi_conversion_reason?: string | null
          poi_conversion_recorded_at?: string | null
          poi_conversion_recorded_by?: string | null
          poi_conversion_reference?: string | null
          poi_engagement_id?: string | null
          preferred_contact_language?: string | null
          product_or_commodity?: string
          profile_record_evidence_summary?: string | null
          profile_record_note?: string | null
          profile_record_recorded_at?: string | null
          profile_record_recorded_by?: string | null
          profile_record_reference?: string | null
          ready_for_poi_at?: string | null
          ready_for_poi_authority_summary?: string | null
          ready_for_poi_by?: string | null
          reason?: string
          registration_number?: string | null
          relationship_status?: string | null
          requesting_org_id?: string
          requesting_user_id?: string
          role?: string
          sector?: string | null
          sla_last_evaluated_at?: string | null
          source_evidence_summary?: string | null
          target_response_date?: string | null
          tax_vat_number?: string | null
          trade_request_id?: string
          updated_at?: string
          urgency?: string
          user_declaration_accepted?: boolean
          user_declaration_accepted_at?: string
          user_facing_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "facilitation_cases_linked_organization_id_fkey"
            columns: ["linked_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facilitation_cases_poi_engagement_id_fkey"
            columns: ["poi_engagement_id"]
            isOneToOne: false
            referencedRelation: "engagement_email_sent_but_status_stuck"
            referencedColumns: ["engagement_id"]
          },
          {
            foreignKeyName: "facilitation_cases_poi_engagement_id_fkey"
            columns: ["poi_engagement_id"]
            isOneToOne: false
            referencedRelation: "poi_engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facilitation_cases_requesting_org_id_fkey"
            columns: ["requesting_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facilitation_cases_trade_request_id_fkey"
            columns: ["trade_request_id"]
            isOneToOne: false
            referencedRelation: "trade_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      facilitation_compliance_escalations: {
        Row: {
          candidate_id: string
          created_at: string
          created_by: string | null
          facilitation_case_id: string
          id: string
          reason: string
          reopened_at: string | null
          reopened_by: string | null
          reopened_reason: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          created_by?: string | null
          facilitation_case_id: string
          id?: string
          reason: string
          reopened_at?: string | null
          reopened_by?: string | null
          reopened_reason?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          created_by?: string | null
          facilitation_case_id?: string
          id?: string
          reason?: string
          reopened_at?: string | null
          reopened_by?: string | null
          reopened_reason?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "facilitation_compliance_escalations_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "facilitation_outreach_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facilitation_compliance_escalations_facilitation_case_id_fkey"
            columns: ["facilitation_case_id"]
            isOneToOne: false
            referencedRelation: "facilitation_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      facilitation_do_not_contact_rules: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          match_severity: string
          reason: string
          revoked_at: string | null
          revoked_by: string | null
          revoked_reason: string | null
          rule_type: string
          source: string
          status: string
          value_norm: string
          value_raw: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          match_severity: string
          reason: string
          revoked_at?: string | null
          revoked_by?: string | null
          revoked_reason?: string | null
          rule_type: string
          source: string
          status?: string
          value_norm: string
          value_raw: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          match_severity?: string
          reason?: string
          revoked_at?: string | null
          revoked_by?: string | null
          revoked_reason?: string | null
          rule_type?: string
          source?: string
          status?: string
          value_norm?: string
          value_raw?: string
        }
        Relationships: []
      }
      facilitation_outreach_candidates: {
        Row: {
          contact_email: string
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string | null
          dnc_check_result: string | null
          duplicate_check_result: string | null
          facilitation_case_id: string
          id: string
          last_gate_evaluated_at: string | null
          org_name: string | null
          org_website: string | null
          outreach_state: string
          updated_at: string
        }
        Insert: {
          contact_email: string
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          dnc_check_result?: string | null
          duplicate_check_result?: string | null
          facilitation_case_id: string
          id?: string
          last_gate_evaluated_at?: string | null
          org_name?: string | null
          org_website?: string | null
          outreach_state?: string
          updated_at?: string
        }
        Update: {
          contact_email?: string
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          dnc_check_result?: string | null
          duplicate_check_result?: string | null
          facilitation_case_id?: string
          id?: string
          last_gate_evaluated_at?: string | null
          org_name?: string | null
          org_website?: string | null
          outreach_state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "facilitation_outreach_candidates_facilitation_case_id_fkey"
            columns: ["facilitation_case_id"]
            isOneToOne: false
            referencedRelation: "facilitation_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      facilitation_outreach_sends: {
        Row: {
          candidate_id: string
          created_at: string
          email_send_log_id: string | null
          id: string
          idempotency_key: string
          recipient_email: string
          send_error: string | null
          sent_at: string | null
          sent_by: string | null
          status: string
          subject: string
          template_id: string
          template_version: number
        }
        Insert: {
          candidate_id: string
          created_at?: string
          email_send_log_id?: string | null
          id?: string
          idempotency_key: string
          recipient_email: string
          send_error?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          subject: string
          template_id: string
          template_version: number
        }
        Update: {
          candidate_id?: string
          created_at?: string
          email_send_log_id?: string | null
          id?: string
          idempotency_key?: string
          recipient_email?: string
          send_error?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          subject?: string
          template_id?: string
          template_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "facilitation_outreach_sends_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "facilitation_outreach_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facilitation_outreach_sends_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "facilitation_outreach_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      facilitation_outreach_templates: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          archived_at: string | null
          archived_by: string | null
          body_html: string | null
          body_text: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          previous_template_id: string | null
          slug: string
          status: string
          subject: string
          submitted_for_approval_at: string | null
          submitted_for_approval_by: string | null
          updated_at: string
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          archived_at?: string | null
          archived_by?: string | null
          body_html?: string | null
          body_text: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          previous_template_id?: string | null
          slug: string
          status?: string
          subject: string
          submitted_for_approval_at?: string | null
          submitted_for_approval_by?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          archived_at?: string | null
          archived_by?: string | null
          body_html?: string | null
          body_text?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          previous_template_id?: string | null
          slug?: string
          status?: string
          subject?: string
          submitted_for_approval_at?: string | null
          submitted_for_approval_by?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "facilitation_outreach_templates_previous_template_id_fkey"
            columns: ["previous_template_id"]
            isOneToOne: false
            referencedRelation: "facilitation_outreach_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      fund_flows: {
        Row: {
          amount: number
          created_at: string
          currency: string
          flow_type: string
          id: string
          idempotency_key: string
          milestone_id: string | null
          participant_id: string
          payload_hash: string
          previous_hash: string | null
          programme_id: string
          recorded_by: string | null
          reference: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          flow_type: string
          id?: string
          idempotency_key: string
          milestone_id?: string | null
          participant_id: string
          payload_hash: string
          previous_hash?: string | null
          programme_id: string
          recorded_by?: string | null
          reference?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          flow_type?: string
          id?: string
          idempotency_key?: string
          milestone_id?: string | null
          participant_id?: string
          payload_hash?: string
          previous_hash?: string | null
          programme_id?: string
          recorded_by?: string | null
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fund_flows_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "programme_milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fund_flows_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "programme_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fund_flows_programme_id_fkey"
            columns: ["programme_id"]
            isOneToOne: false
            referencedRelation: "programmes"
            referencedColumns: ["id"]
          },
        ]
      }
      governance_doc_registry: {
        Row: {
          active: boolean
          allowed_from_state: string
          allowed_to_state: string
          category: string
          doc_type: string
          fixed_token_burn_amount: number
          id: string
          industry_code: string
          jurisdiction_code: string
          mandatory_flag: boolean
          org_id: string
          requires_signature: boolean
        }
        Insert: {
          active?: boolean
          allowed_from_state: string
          allowed_to_state: string
          category: string
          doc_type: string
          fixed_token_burn_amount?: number
          id?: string
          industry_code: string
          jurisdiction_code: string
          mandatory_flag?: boolean
          org_id: string
          requires_signature?: boolean
        }
        Update: {
          active?: boolean
          allowed_from_state?: string
          allowed_to_state?: string
          category?: string
          doc_type?: string
          fixed_token_burn_amount?: number
          id?: string
          industry_code?: string
          jurisdiction_code?: string
          mandatory_flag?: boolean
          org_id?: string
          requires_signature?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "governance_doc_registry_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      governance_documents: {
        Row: {
          created_at: string
          deal_reference_id: string
          deal_reference_type: string
          document_path: string | null
          id: string
          org_id: string
          registry_id: string
          status: string
          token_burned: boolean
          validated_at: string | null
        }
        Insert: {
          created_at?: string
          deal_reference_id: string
          deal_reference_type: string
          document_path?: string | null
          id?: string
          org_id: string
          registry_id: string
          status?: string
          token_burned?: boolean
          validated_at?: string | null
        }
        Update: {
          created_at?: string
          deal_reference_id?: string
          deal_reference_type?: string
          document_path?: string | null
          id?: string
          org_id?: string
          registry_id?: string
          status?: string
          token_burned?: boolean
          validated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "governance_documents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_documents_registry_id_fkey"
            columns: ["registry_id"]
            isOneToOne: false
            referencedRelation: "governance_doc_registry"
            referencedColumns: ["id"]
          },
        ]
      }
      governance_taxonomy_violations: {
        Row: {
          aggregate_id: string | null
          aggregate_type: string | null
          domain: string | null
          event_id: string
          event_type: string
          id: string
          observed_at: string
          org_id: string
          payload_keys: string[] | null
          reason: string
        }
        Insert: {
          aggregate_id?: string | null
          aggregate_type?: string | null
          domain?: string | null
          event_id: string
          event_type: string
          id?: string
          observed_at?: string
          org_id: string
          payload_keys?: string[] | null
          reason: string
        }
        Update: {
          aggregate_id?: string | null
          aggregate_type?: string | null
          domain?: string | null
          event_id?: string
          event_type?: string
          id?: string
          observed_at?: string
          org_id?: string
          payload_keys?: string[] | null
          reason?: string
        }
        Relationships: []
      }
      governance_waivers: {
        Row: {
          created_at: string
          expires_at: string
          granted_at: string
          granted_by: string
          match_id: string | null
          max_uses: number
          note: string | null
          org_id: string
          poi_id: string | null
          posture: string
          reason_code: string
          renewed_from: string | null
          scope: string
          scope_id: string | null
          status: string
          updated_at: string
          uses: number
          wad_id: string | null
          waiver_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          granted_at?: string
          granted_by: string
          match_id?: string | null
          max_uses?: number
          note?: string | null
          org_id: string
          poi_id?: string | null
          posture: string
          reason_code: string
          renewed_from?: string | null
          scope: string
          scope_id?: string | null
          status?: string
          updated_at?: string
          uses?: number
          wad_id?: string | null
          waiver_id?: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          granted_at?: string
          granted_by?: string
          match_id?: string | null
          max_uses?: number
          note?: string | null
          org_id?: string
          poi_id?: string | null
          posture?: string
          reason_code?: string
          renewed_from?: string | null
          scope?: string
          scope_id?: string | null
          status?: string
          updated_at?: string
          uses?: number
          wad_id?: string | null
          waiver_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "governance_waivers_renewed_from_fkey"
            columns: ["renewed_from"]
            isOneToOne: false
            referencedRelation: "governance_waivers"
            referencedColumns: ["waiver_id"]
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
      interests: {
        Row: {
          context: string | null
          created_at: string
          from_entity_id: string
          id: string
          org_id: string
          status: string
          to_entity_id: string
        }
        Insert: {
          context?: string | null
          created_at?: string
          from_entity_id: string
          id?: string
          org_id: string
          status?: string
          to_entity_id: string
        }
        Update: {
          context?: string | null
          created_at?: string
          from_entity_id?: string
          id?: string
          org_id?: string
          status?: string
          to_entity_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "interests_from_entity_id_fkey"
            columns: ["from_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interests_to_entity_id_fkey"
            columns: ["to_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          declined_at: string | null
          declined_reason: string | null
          expires_at: string | null
          from_org_id: string
          from_user_id: string | null
          id: string
          match_id: string | null
          search_query: string | null
          search_results: Json | null
          selected_result_data: Json
          selected_result_id: string
          status: string
          to_email: string | null
          to_org_id: string | null
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          declined_at?: string | null
          declined_reason?: string | null
          expires_at?: string | null
          from_org_id: string
          from_user_id?: string | null
          id?: string
          match_id?: string | null
          search_query?: string | null
          search_results?: Json | null
          selected_result_data?: Json
          selected_result_id: string
          status?: string
          to_email?: string | null
          to_org_id?: string | null
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          declined_at?: string | null
          declined_reason?: string | null
          expires_at?: string | null
          from_org_id?: string
          from_user_id?: string | null
          id?: string
          match_id?: string | null
          search_query?: string | null
          search_results?: Json | null
          selected_result_data?: Json
          selected_result_id?: string
          status?: string
          to_email?: string | null
          to_org_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      jurisdiction_selections: {
        Row: {
          created_at: string
          escalation_reason: string | null
          id: string
          match_id: string
          org_id: string
          selected_by: string | null
          selected_jurisdiction: string
          selection_method: string
          surfaced_jurisdictions: Json
        }
        Insert: {
          created_at?: string
          escalation_reason?: string | null
          id?: string
          match_id: string
          org_id: string
          selected_by?: string | null
          selected_jurisdiction: string
          selection_method?: string
          surfaced_jurisdictions?: Json
        }
        Update: {
          created_at?: string
          escalation_reason?: string | null
          id?: string
          match_id?: string
          org_id?: string
          selected_by?: string | null
          selected_jurisdiction?: string
          selection_method?: string
          surfaced_jurisdictions?: Json
        }
        Relationships: [
          {
            foreignKeyName: "jurisdiction_selections_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "match_evidence"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "jurisdiction_selections_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jurisdiction_selections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      kyc_documents: {
        Row: {
          created_at: string
          doc_type: string
          expiry_date: string | null
          extracted_metadata: Json | null
          file_size: number | null
          filename: string
          id: string
          id_number_hash: string | null
          issuing_country: string | null
          mime_type: string | null
          org_id: string
          sha256_hash: string
          status: string
          storage_path: string
          updated_at: string
          uploaded_by: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          created_at?: string
          doc_type: string
          expiry_date?: string | null
          extracted_metadata?: Json | null
          file_size?: number | null
          filename: string
          id?: string
          id_number_hash?: string | null
          issuing_country?: string | null
          mime_type?: string | null
          org_id: string
          sha256_hash: string
          status?: string
          storage_path: string
          updated_at?: string
          uploaded_by?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          created_at?: string
          doc_type?: string
          expiry_date?: string | null
          extracted_metadata?: Json | null
          file_size?: number | null
          filename?: string
          id?: string
          id_number_hash?: string | null
          issuing_country?: string | null
          mime_type?: string | null
          org_id?: string
          sha256_hash?: string
          status?: string
          storage_path?: string
          updated_at?: string
          uploaded_by?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kyc_documents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      kyc_status: {
        Row: {
          completeness_percentage: number
          created_at: string
          id: string
          last_reviewed_at: string | null
          org_id: string
          required_docs: Json
          status: string
          submitted_docs: Json
          updated_at: string
        }
        Insert: {
          completeness_percentage?: number
          created_at?: string
          id?: string
          last_reviewed_at?: string | null
          org_id: string
          required_docs?: Json
          status?: string
          submitted_docs?: Json
          updated_at?: string
        }
        Update: {
          completeness_percentage?: number
          created_at?: string
          id?: string
          last_reviewed_at?: string | null
          org_id?: string
          required_docs?: Json
          status?: string
          submitted_docs?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kyc_status_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          match_id: string | null
          occurred_at: string
          org_id: string
          payload: Json
          payload_hash: string
          prev_hash: string | null
          sequence_number: number
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          match_id?: string | null
          occurred_at?: string
          org_id: string
          payload?: Json
          payload_hash: string
          prev_hash?: string | null
          sequence_number?: number
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          match_id?: string | null
          occurred_at?: string
          org_id?: string
          payload?: Json
          payload_hash?: string
          prev_hash?: string | null
          sequence_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "ledger_events_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "match_evidence"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "ledger_events_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_holds: {
        Row: {
          applied_at: string
          applied_by: string
          created_at: string
          id: string
          metadata: Json
          reason: string
          released_at: string | null
          released_by: string | null
          released_reason: string | null
          scope_id: string
          scope_type: string
          status: string
          updated_at: string
        }
        Insert: {
          applied_at?: string
          applied_by: string
          created_at?: string
          id?: string
          metadata?: Json
          reason: string
          released_at?: string | null
          released_by?: string | null
          released_reason?: string | null
          scope_id: string
          scope_type: string
          status?: string
          updated_at?: string
        }
        Update: {
          applied_at?: string
          applied_by?: string
          created_at?: string
          id?: string
          metadata?: Json
          reason?: string
          released_at?: string | null
          released_by?: string | null
          released_reason?: string | null
          scope_id?: string
          scope_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      licences: {
        Row: {
          amount_usd: number
          created_at: string
          expires_at: string
          id: string
          org_id: string
          payment_reference: string | null
          starts_at: string
          status: string
          tier: string
          updated_at: string
        }
        Insert: {
          amount_usd: number
          created_at?: string
          expires_at: string
          id?: string
          org_id: string
          payment_reference?: string | null
          starts_at?: string
          status?: string
          tier: string
          updated_at?: string
        }
        Update: {
          amount_usd?: number
          created_at?: string
          expires_at?: string
          id?: string
          org_id?: string
          payment_reference?: string | null
          starts_at?: string
          status?: string
          tier?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "licences_org_id_fkey"
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
      match_challenge_comments: {
        Row: {
          author_org_id: string | null
          author_role: string
          author_user_id: string
          body: string
          challenge_id: string
          created_at: string
          id: string
        }
        Insert: {
          author_org_id?: string | null
          author_role: string
          author_user_id: string
          body: string
          challenge_id: string
          created_at?: string
          id?: string
        }
        Update: {
          author_org_id?: string | null
          author_role?: string
          author_user_id?: string
          body?: string
          challenge_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_challenge_comments_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "match_challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      match_challenge_evidence: {
        Row: {
          challenge_id: string
          created_at: string
          filename: string
          id: string
          mime_type: string
          sha256: string
          size_bytes: number
          storage_path: string
          uploaded_by_org_id: string | null
          uploaded_by_user_id: string
        }
        Insert: {
          challenge_id: string
          created_at?: string
          filename: string
          id?: string
          mime_type: string
          sha256: string
          size_bytes: number
          storage_path: string
          uploaded_by_org_id?: string | null
          uploaded_by_user_id: string
        }
        Update: {
          challenge_id?: string
          created_at?: string
          filename?: string
          id?: string
          mime_type?: string
          sha256?: string
          size_bytes?: number
          storage_path?: string
          uploaded_by_org_id?: string | null
          uploaded_by_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_challenge_evidence_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "match_challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      match_challenges: {
        Row: {
          break_glass_override_used: boolean
          closed_at: string | null
          closed_by_user_id: string | null
          created_at: string
          id: string
          match_id: string
          org_id: string
          outcome_code: string | null
          outcome_summary: string | null
          raised_by_org_id: string | null
          raised_by_role: string
          raised_by_user_id: string
          rating_impact_emitted: boolean
          status: string
          subject_code: string
          summary: string
          under_review_at: string | null
          updated_at: string
        }
        Insert: {
          break_glass_override_used?: boolean
          closed_at?: string | null
          closed_by_user_id?: string | null
          created_at?: string
          id?: string
          match_id: string
          org_id: string
          outcome_code?: string | null
          outcome_summary?: string | null
          raised_by_org_id?: string | null
          raised_by_role: string
          raised_by_user_id: string
          rating_impact_emitted?: boolean
          status?: string
          subject_code: string
          summary: string
          under_review_at?: string | null
          updated_at?: string
        }
        Update: {
          break_glass_override_used?: boolean
          closed_at?: string | null
          closed_by_user_id?: string | null
          created_at?: string
          id?: string
          match_id?: string
          org_id?: string
          outcome_code?: string | null
          outcome_summary?: string | null
          raised_by_org_id?: string | null
          raised_by_role?: string
          raised_by_user_id?: string
          rating_impact_emitted?: boolean
          status?: string
          subject_code?: string
          summary?: string
          under_review_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_challenges_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "match_evidence"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "match_challenges_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      match_counterparty_intel: {
        Row: {
          auto_generated_at: string | null
          auto_sources: Json
          auto_status: string
          auto_summary: string | null
          counterparty_name: string
          created_at: string
          created_by: string | null
          id: string
          linkedin_url: string | null
          match_id: string
          notes: string | null
          org_id: string
          other_social_urls: Json
          presence_confirmed: boolean
          presence_confirmed_at: string | null
          presence_confirmed_by: string | null
          side: string
          updated_at: string
          website_url: string | null
        }
        Insert: {
          auto_generated_at?: string | null
          auto_sources?: Json
          auto_status?: string
          auto_summary?: string | null
          counterparty_name: string
          created_at?: string
          created_by?: string | null
          id?: string
          linkedin_url?: string | null
          match_id: string
          notes?: string | null
          org_id: string
          other_social_urls?: Json
          presence_confirmed?: boolean
          presence_confirmed_at?: string | null
          presence_confirmed_by?: string | null
          side: string
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          auto_generated_at?: string | null
          auto_sources?: Json
          auto_status?: string
          auto_summary?: string | null
          counterparty_name?: string
          created_at?: string
          created_by?: string | null
          id?: string
          linkedin_url?: string | null
          match_id?: string
          notes?: string | null
          org_id?: string
          other_social_urls?: Json
          presence_confirmed?: boolean
          presence_confirmed_at?: string | null
          presence_confirmed_by?: string | null
          side?: string
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "match_counterparty_intel_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "match_evidence"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "match_counterparty_intel_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      match_documents: {
        Row: {
          change_notes: string | null
          created_at: string
          doc_type: string
          expiry_date: string | null
          file_size: number | null
          filename: string
          id: string
          is_current_version: boolean
          magic_bytes_verified: boolean | null
          match_id: string
          mime_type: string | null
          notes: string | null
          org_id: string
          rejection_reason: string | null
          root_document_id: string | null
          server_detected_mime: string | null
          sha256_hash: string
          status: string
          storage_path: string
          superseded_at: string | null
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
          change_notes?: string | null
          created_at?: string
          doc_type?: string
          expiry_date?: string | null
          file_size?: number | null
          filename: string
          id?: string
          is_current_version?: boolean
          magic_bytes_verified?: boolean | null
          match_id: string
          mime_type?: string | null
          notes?: string | null
          org_id: string
          rejection_reason?: string | null
          root_document_id?: string | null
          server_detected_mime?: string | null
          sha256_hash: string
          status?: string
          storage_path: string
          superseded_at?: string | null
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
          change_notes?: string | null
          created_at?: string
          doc_type?: string
          expiry_date?: string | null
          file_size?: number | null
          filename?: string
          id?: string
          is_current_version?: boolean
          magic_bytes_verified?: boolean | null
          match_id?: string
          mime_type?: string | null
          notes?: string | null
          org_id?: string
          rejection_reason?: string | null
          root_document_id?: string | null
          server_detected_mime?: string | null
          sha256_hash?: string
          status?: string
          storage_path?: string
          superseded_at?: string | null
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
            foreignKeyName: "match_documents_root_document_id_fkey"
            columns: ["root_document_id"]
            isOneToOne: false
            referencedRelation: "match_documents"
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
            referencedRelation: "account_hard_delete_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "match_documents_uploader_user_id_fkey"
            columns: ["uploader_user_id"]
            isOneToOne: false
            referencedRelation: "org_colleagues_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_documents_uploader_user_id_fkey"
            columns: ["uploader_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_documents_uploader_user_id_fkey"
            columns: ["uploader_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_safe"
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
      match_legacy_detection_emits: {
        Row: {
          created_at: string
          emitted_at: string
          emitted_by_user_id: string | null
          id: string
          match_id: string
          reasons: Json
          signature: string
        }
        Insert: {
          created_at?: string
          emitted_at?: string
          emitted_by_user_id?: string | null
          id?: string
          match_id: string
          reasons?: Json
          signature: string
        }
        Update: {
          created_at?: string
          emitted_at?: string
          emitted_by_user_id?: string | null
          id?: string
          match_id?: string
          reasons?: Json
          signature?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_legacy_detection_emits_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "match_evidence"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "match_legacy_detection_emits_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      match_named_contacts: {
        Row: {
          assigned_at: string
          assigned_by_role: string
          assigned_by_user_id: string
          contact_email: string
          contact_name: string
          converted_at: string | null
          converted_user_id: string | null
          id: string
          match_id: string
          metadata: Json
          org_id: string
          replaced_by_id: string | null
          revoked_at: string | null
          revoked_by_user_id: string | null
          revoked_reason: string | null
          side: string
          status: string
        }
        Insert: {
          assigned_at?: string
          assigned_by_role: string
          assigned_by_user_id: string
          contact_email: string
          contact_name: string
          converted_at?: string | null
          converted_user_id?: string | null
          id?: string
          match_id: string
          metadata?: Json
          org_id: string
          replaced_by_id?: string | null
          revoked_at?: string | null
          revoked_by_user_id?: string | null
          revoked_reason?: string | null
          side: string
          status?: string
        }
        Update: {
          assigned_at?: string
          assigned_by_role?: string
          assigned_by_user_id?: string
          contact_email?: string
          contact_name?: string
          converted_at?: string | null
          converted_user_id?: string | null
          id?: string
          match_id?: string
          metadata?: Json
          org_id?: string
          replaced_by_id?: string | null
          revoked_at?: string | null
          revoked_by_user_id?: string | null
          revoked_reason?: string | null
          side?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_named_contacts_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "match_evidence"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "match_named_contacts_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_named_contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_named_contacts_replaced_by_id_fkey"
            columns: ["replaced_by_id"]
            isOneToOne: false
            referencedRelation: "match_named_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      match_notes: {
        Row: {
          content: string
          created_at: string | null
          id: string
          match_id: string
          org_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          match_id: string
          org_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          match_id?: string
          org_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_notes_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "match_evidence"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "match_notes_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_notes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      match_ui_prefs: {
        Row: {
          created_at: string
          id: string
          match_id: string
          sub_tab: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          match_id: string
          sub_tab?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          match_id?: string
          sub_tab?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_ui_prefs_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "match_evidence"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "match_ui_prefs_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          ai_auto_trigger_status: string | null
          ai_last_run_at: string | null
          ai_run_count: number
          buyer_authorised_user_id: string | null
          buyer_committed_at: string | null
          buyer_id: string | null
          buyer_name: string | null
          buyer_org_id: string | null
          commodity: string
          counterparty_sighted_at: string | null
          created_at: string
          created_by: string | null
          declared_value_usd: number | null
          demo_dataset_id: string | null
          destination_country: string | null
          event_chain_hash: string | null
          finality_tokens_burned: number | null
          hash: string
          id: string
          is_demo: boolean
          match_type: string
          metadata: Json | null
          org_id: string
          origin_country: string | null
          poi_state: string
          previous_event_hash: string | null
          price_amount: number | null
          price_currency: string | null
          quantity_amount: number | null
          quantity_unit: string | null
          seller_authorised_user_id: string | null
          seller_committed_at: string | null
          seller_id: string | null
          seller_name: string | null
          seller_org_id: string | null
          settled_at: string | null
          sighting_tokens_burned: number | null
          state: string
          status: string
          terms: string | null
          trade_request_id: string | null
        }
        Insert: {
          ai_auto_trigger_status?: string | null
          ai_last_run_at?: string | null
          ai_run_count?: number
          buyer_authorised_user_id?: string | null
          buyer_committed_at?: string | null
          buyer_id?: string | null
          buyer_name?: string | null
          buyer_org_id?: string | null
          commodity: string
          counterparty_sighted_at?: string | null
          created_at?: string
          created_by?: string | null
          declared_value_usd?: number | null
          demo_dataset_id?: string | null
          destination_country?: string | null
          event_chain_hash?: string | null
          finality_tokens_burned?: number | null
          hash: string
          id?: string
          is_demo?: boolean
          match_type?: string
          metadata?: Json | null
          org_id: string
          origin_country?: string | null
          poi_state?: string
          previous_event_hash?: string | null
          price_amount?: number | null
          price_currency?: string | null
          quantity_amount?: number | null
          quantity_unit?: string | null
          seller_authorised_user_id?: string | null
          seller_committed_at?: string | null
          seller_id?: string | null
          seller_name?: string | null
          seller_org_id?: string | null
          settled_at?: string | null
          sighting_tokens_burned?: number | null
          state?: string
          status?: string
          terms?: string | null
          trade_request_id?: string | null
        }
        Update: {
          ai_auto_trigger_status?: string | null
          ai_last_run_at?: string | null
          ai_run_count?: number
          buyer_authorised_user_id?: string | null
          buyer_committed_at?: string | null
          buyer_id?: string | null
          buyer_name?: string | null
          buyer_org_id?: string | null
          commodity?: string
          counterparty_sighted_at?: string | null
          created_at?: string
          created_by?: string | null
          declared_value_usd?: number | null
          demo_dataset_id?: string | null
          destination_country?: string | null
          event_chain_hash?: string | null
          finality_tokens_burned?: number | null
          hash?: string
          id?: string
          is_demo?: boolean
          match_type?: string
          metadata?: Json | null
          org_id?: string
          origin_country?: string | null
          poi_state?: string
          previous_event_hash?: string | null
          price_amount?: number | null
          price_currency?: string | null
          quantity_amount?: number | null
          quantity_unit?: string | null
          seller_authorised_user_id?: string | null
          seller_committed_at?: string | null
          seller_id?: string | null
          seller_name?: string | null
          seller_org_id?: string | null
          settled_at?: string | null
          sighting_tokens_burned?: number | null
          state?: string
          status?: string
          terms?: string | null
          trade_request_id?: string | null
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
          {
            foreignKeyName: "matches_trade_request_id_fkey"
            columns: ["trade_request_id"]
            isOneToOne: false
            referencedRelation: "trade_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      mutual_interests: {
        Row: {
          entity_a: string
          entity_b: string
          expires_at: string
          formed_at: string
          id: string
          org_id: string
          status: string
        }
        Insert: {
          entity_a: string
          entity_b: string
          expires_at: string
          formed_at?: string
          id?: string
          org_id: string
          status?: string
        }
        Update: {
          entity_a?: string
          entity_b?: string
          expires_at?: string
          formed_at?: string
          id?: string
          org_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "mutual_interests_entity_a_fkey"
            columns: ["entity_a"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mutual_interests_entity_b_fkey"
            columns: ["entity_b"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mutual_interests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_dispatches: {
        Row: {
          channel: string
          created_at: string
          delivered_at: string | null
          dispatched_at: string | null
          error_message: string | null
          event_type: string
          failed_at: string | null
          id: string
          message_id: string | null
          metadata: Json
          opened_at: string | null
          recipient_address: string | null
          recipient_org_id: string | null
          recipient_role: string | null
          recipient_user_id: string | null
          reference_id: string
          reference_type: string
          routing_policy_key: string | null
          status: string
          template_name: string | null
          updated_at: string
        }
        Insert: {
          channel: string
          created_at?: string
          delivered_at?: string | null
          dispatched_at?: string | null
          error_message?: string | null
          event_type: string
          failed_at?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json
          opened_at?: string | null
          recipient_address?: string | null
          recipient_org_id?: string | null
          recipient_role?: string | null
          recipient_user_id?: string | null
          reference_id: string
          reference_type: string
          routing_policy_key?: string | null
          status?: string
          template_name?: string | null
          updated_at?: string
        }
        Update: {
          channel?: string
          created_at?: string
          delivered_at?: string | null
          dispatched_at?: string | null
          error_message?: string | null
          event_type?: string
          failed_at?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json
          opened_at?: string | null
          recipient_address?: string | null
          recipient_org_id?: string | null
          recipient_role?: string | null
          recipient_user_id?: string | null
          reference_id?: string
          reference_type?: string
          routing_policy_key?: string | null
          status?: string
          template_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          created_at: string
          preferences: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          preferences?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          preferences?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string | null
          demo_dataset_id: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          is_demo: boolean
          link: string | null
          org_id: string | null
          read: boolean | null
          resolved_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string | null
          demo_dataset_id?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_demo?: boolean
          link?: string | null
          org_id?: string | null
          read?: boolean | null
          resolved_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string | null
          demo_dataset_id?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_demo?: boolean
          link?: string | null
          org_id?: string | null
          read?: boolean | null
          resolved_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_verification_requests: {
        Row: {
          assigned_to: string | null
          clip_on_billed_at: string | null
          completed_at: string | null
          compliance_hold_id: string | null
          created_at: string
          demo_dataset_id: string | null
          id: string
          is_demo: boolean
          kind: string
          match_id: string | null
          org_id: string | null
          outcome: string | null
          priced_cost_zar: number | null
          priced_currency: string | null
          priced_margin_pct: number | null
          priced_total_zar: number | null
          pricing_mode: string | null
          raised_by: string | null
          reason: string | null
          reviewer_notes: string | null
          status: string
          subject_name: string
          subject_org_id: string | null
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          clip_on_billed_at?: string | null
          completed_at?: string | null
          compliance_hold_id?: string | null
          created_at?: string
          demo_dataset_id?: string | null
          id?: string
          is_demo?: boolean
          kind: string
          match_id?: string | null
          org_id?: string | null
          outcome?: string | null
          priced_cost_zar?: number | null
          priced_currency?: string | null
          priced_margin_pct?: number | null
          priced_total_zar?: number | null
          pricing_mode?: string | null
          raised_by?: string | null
          reason?: string | null
          reviewer_notes?: string | null
          status?: string
          subject_name: string
          subject_org_id?: string | null
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          clip_on_billed_at?: string | null
          completed_at?: string | null
          compliance_hold_id?: string | null
          created_at?: string
          demo_dataset_id?: string | null
          id?: string
          is_demo?: boolean
          kind?: string
          match_id?: string | null
          org_id?: string | null
          outcome?: string | null
          priced_cost_zar?: number | null
          priced_currency?: string | null
          priced_margin_pct?: number | null
          priced_total_zar?: number | null
          pricing_mode?: string | null
          raised_by?: string | null
          reason?: string | null
          reviewer_notes?: string | null
          status?: string
          subject_name?: string
          subject_org_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "operator_verification_requests_compliance_hold_id_fkey"
            columns: ["compliance_hold_id"]
            isOneToOne: false
            referencedRelation: "compliance_holds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_verification_requests_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "match_evidence"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "operator_verification_requests_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
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
      org_directors: {
        Row: {
          created_at: string
          full_name: string
          id: string
          id_number_hash: string | null
          is_pep: boolean | null
          nationality: string | null
          org_id: string
          ownership_percentage: number | null
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name: string
          id?: string
          id_number_hash?: string | null
          is_pep?: boolean | null
          nationality?: string | null
          org_id: string
          ownership_percentage?: number | null
          role?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          id_number_hash?: string | null
          is_pep?: boolean | null
          nationality?: string | null
          org_id?: string
          ownership_percentage?: number | null
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_directors_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_governance_profiles: {
        Row: {
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          id: string
          notes: string | null
          org_id: string
          updated_at: string
          verification_gate_position: Database["public"]["Enums"]["gate_position"]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          notes?: string | null
          org_id: string
          updated_at?: string
          verification_gate_position?: Database["public"]["Enums"]["gate_position"]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          notes?: string | null
          org_id?: string
          updated_at?: string
          verification_gate_position?: Database["public"]["Enums"]["gate_position"]
        }
        Relationships: []
      }
      org_retention_policies: {
        Row: {
          created_at: string
          floor_days: number
          id: string
          metadata: Json
          org_id: string
          reason: string
          record_class: Database["public"]["Enums"]["org_retention_record_class"]
          retention_days: number
          set_at: string
          set_by: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          floor_days: number
          id?: string
          metadata?: Json
          org_id: string
          reason: string
          record_class: Database["public"]["Enums"]["org_retention_record_class"]
          retention_days: number
          set_at?: string
          set_by?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          floor_days?: number
          id?: string
          metadata?: Json
          org_id?: string
          reason?: string
          record_class?: Database["public"]["Enums"]["org_retention_record_class"]
          retention_days?: number
          set_at?: string
          set_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_retention_policies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_scim_user_states: {
        Row: {
          created_at: string
          external_id: string | null
          id: string
          last_state_change_at: string
          last_state_change_reason: string | null
          org_id: string
          source: string
          state: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          external_id?: string | null
          id?: string
          last_state_change_at?: string
          last_state_change_reason?: string | null
          org_id: string
          source?: string
          state?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          external_id?: string | null
          id?: string
          last_state_change_at?: string
          last_state_change_reason?: string | null
          org_id?: string
          source?: string
          state?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_scim_user_states_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_sso_configs: {
        Row: {
          acs_url: string | null
          certificate_status: string
          created_at: string
          entity_id: string | null
          failure_reason: string | null
          id: string
          last_test_result: string | null
          last_tested_at: string | null
          metadata_url: string | null
          metadata_xml_ref: string | null
          org_id: string
          provider: string
          requested_by: string | null
          reviewed_by: string | null
          status: string
          supabase_sso_provider_id: string | null
          updated_at: string
          verified_domains: string[]
        }
        Insert: {
          acs_url?: string | null
          certificate_status?: string
          created_at?: string
          entity_id?: string | null
          failure_reason?: string | null
          id?: string
          last_test_result?: string | null
          last_tested_at?: string | null
          metadata_url?: string | null
          metadata_xml_ref?: string | null
          org_id: string
          provider?: string
          requested_by?: string | null
          reviewed_by?: string | null
          status?: string
          supabase_sso_provider_id?: string | null
          updated_at?: string
          verified_domains?: string[]
        }
        Update: {
          acs_url?: string | null
          certificate_status?: string
          created_at?: string
          entity_id?: string | null
          failure_reason?: string | null
          id?: string
          last_test_result?: string | null
          last_tested_at?: string | null
          metadata_url?: string | null
          metadata_xml_ref?: string | null
          org_id?: string
          provider?: string
          requested_by?: string | null
          reviewed_by?: string | null
          status?: string
          supabase_sso_provider_id?: string | null
          updated_at?: string
          verified_domains?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "org_sso_configs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address: Json | null
          authorised_signatory: string | null
          billing_hold: boolean
          billing_hold_applied_at: string | null
          billing_hold_applied_by: string | null
          billing_hold_reason: string | null
          clip_on_always_on: boolean
          clip_on_subscription_started_at: string | null
          created_at: string
          cross_border_consent: boolean
          data_region: string
          data_residency_region: string | null
          demo_dataset_id: string | null
          frozen: boolean
          frozen_at: string | null
          frozen_by: string | null
          frozen_reason: string | null
          id: string
          industry: string | null
          is_demo: boolean
          jurisdictions: string[] | null
          legal_name: string | null
          logo_url: string | null
          name: string
          onboarding_hold_reason: string | null
          onboarding_hold_review_id: string | null
          registration_number: string | null
          sandbox_enabled: boolean | null
          status: string
          tax_number: string | null
          token_opening_balance: number
          trading_name: string | null
          updated_at: string
          vat_number: string | null
          website: string | null
        }
        Insert: {
          address?: Json | null
          authorised_signatory?: string | null
          billing_hold?: boolean
          billing_hold_applied_at?: string | null
          billing_hold_applied_by?: string | null
          billing_hold_reason?: string | null
          clip_on_always_on?: boolean
          clip_on_subscription_started_at?: string | null
          created_at?: string
          cross_border_consent?: boolean
          data_region?: string
          data_residency_region?: string | null
          demo_dataset_id?: string | null
          frozen?: boolean
          frozen_at?: string | null
          frozen_by?: string | null
          frozen_reason?: string | null
          id?: string
          industry?: string | null
          is_demo?: boolean
          jurisdictions?: string[] | null
          legal_name?: string | null
          logo_url?: string | null
          name: string
          onboarding_hold_reason?: string | null
          onboarding_hold_review_id?: string | null
          registration_number?: string | null
          sandbox_enabled?: boolean | null
          status?: string
          tax_number?: string | null
          token_opening_balance?: number
          trading_name?: string | null
          updated_at?: string
          vat_number?: string | null
          website?: string | null
        }
        Update: {
          address?: Json | null
          authorised_signatory?: string | null
          billing_hold?: boolean
          billing_hold_applied_at?: string | null
          billing_hold_applied_by?: string | null
          billing_hold_reason?: string | null
          clip_on_always_on?: boolean
          clip_on_subscription_started_at?: string | null
          created_at?: string
          cross_border_consent?: boolean
          data_region?: string
          data_residency_region?: string | null
          demo_dataset_id?: string | null
          frozen?: boolean
          frozen_at?: string | null
          frozen_by?: string | null
          frozen_reason?: string | null
          id?: string
          industry?: string | null
          is_demo?: boolean
          jurisdictions?: string[] | null
          legal_name?: string | null
          logo_url?: string | null
          name?: string
          onboarding_hold_reason?: string | null
          onboarding_hold_review_id?: string | null
          registration_number?: string | null
          sandbox_enabled?: boolean | null
          status?: string
          tax_number?: string | null
          token_opening_balance?: number
          trading_name?: string | null
          updated_at?: string
          vat_number?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_onboarding_hold_review_fk"
            columns: ["onboarding_hold_review_id"]
            isOneToOne: false
            referencedRelation: "data_residency_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      ownership_links: {
        Row: {
          company_entity_id: string
          created_at: string
          id: string
          org_id: string
          owner_entity_id: string
          ownership_percent: number
        }
        Insert: {
          company_entity_id: string
          created_at?: string
          id?: string
          org_id: string
          owner_entity_id: string
          ownership_percent: number
        }
        Update: {
          company_entity_id?: string
          created_at?: string
          id?: string
          org_id?: string
          owner_entity_id?: string
          ownership_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "ownership_links_company_entity_id_fkey"
            columns: ["company_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ownership_links_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ownership_links_owner_entity_id_fkey"
            columns: ["owner_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      p3_attestations: {
        Row: {
          clause_pack_id: string
          id: string
          org_id: string
          signatory_person_id: string
          signature_payload: string
          signed_at: string
          status: string
          wad_id: string
        }
        Insert: {
          clause_pack_id: string
          id?: string
          org_id: string
          signatory_person_id: string
          signature_payload: string
          signed_at?: string
          status?: string
          wad_id: string
        }
        Update: {
          clause_pack_id?: string
          id?: string
          org_id?: string
          signatory_person_id?: string
          signature_payload?: string
          signed_at?: string
          status?: string
          wad_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "p3_attestations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "p3_attestations_signatory_person_id_fkey"
            columns: ["signatory_person_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "p3_attestations_wad_id_fkey"
            columns: ["wad_id"]
            isOneToOne: false
            referencedRelation: "p3_wads"
            referencedColumns: ["id"]
          },
        ]
      }
      p3_wads: {
        Row: {
          created_at: string
          denial_reasons: Json | null
          id: string
          issued_at: string | null
          org_id: string
          poi_id: string
          state: string
        }
        Insert: {
          created_at?: string
          denial_reasons?: Json | null
          id?: string
          issued_at?: string | null
          org_id: string
          poi_id: string
          state?: string
        }
        Update: {
          created_at?: string
          denial_reasons?: Json | null
          id?: string
          issued_at?: string | null
          org_id?: string
          poi_id?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "p3_wads_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "p3_wads_poi_id_fkey"
            columns: ["poi_id"]
            isOneToOne: false
            referencedRelation: "pois"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_dispute_affected_burns: {
        Row: {
          billing_review_required: boolean
          cleared_at: string | null
          cleared_by: string | null
          created_at: string
          id: string
          payment_dispute_id: string
          token_ledger_id: string
        }
        Insert: {
          billing_review_required?: boolean
          cleared_at?: string | null
          cleared_by?: string | null
          created_at?: string
          id?: string
          payment_dispute_id: string
          token_ledger_id: string
        }
        Update: {
          billing_review_required?: boolean
          cleared_at?: string | null
          cleared_by?: string | null
          created_at?: string
          id?: string
          payment_dispute_id?: string
          token_ledger_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_dispute_affected_burns_payment_dispute_id_fkey"
            columns: ["payment_dispute_id"]
            isOneToOne: false
            referencedRelation: "payment_disputes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_dispute_affected_burns_token_ledger_id_fkey"
            columns: ["token_ledger_id"]
            isOneToOne: false
            referencedRelation: "token_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_dispute_affected_burns_token_ledger_id_fkey"
            columns: ["token_ledger_id"]
            isOneToOne: false
            referencedRelation: "v_poi_burn_reconciliation"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_disputes: {
        Row: {
          created_at: string
          credits_frozen: number
          credits_issued: number
          credits_used_at_open: number
          disputed_credit_hold_id: string | null
          id: string
          metadata: Json
          org_id: string
          provider: string
          provider_dispute_reference: string
          resolution_reason: string | null
          resolved_at: string | null
          resolved_by: string | null
          source: string
          status: string
          token_purchase_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          credits_frozen?: number
          credits_issued: number
          credits_used_at_open: number
          disputed_credit_hold_id?: string | null
          id?: string
          metadata?: Json
          org_id: string
          provider?: string
          provider_dispute_reference: string
          resolution_reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source: string
          status?: string
          token_purchase_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          credits_frozen?: number
          credits_issued?: number
          credits_used_at_open?: number
          disputed_credit_hold_id?: string | null
          id?: string
          metadata?: Json
          org_id?: string
          provider?: string
          provider_dispute_reference?: string
          resolution_reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source?: string
          status?: string
          token_purchase_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_disputes_disputed_credit_hold_id_fkey"
            columns: ["disputed_credit_hold_id"]
            isOneToOne: false
            referencedRelation: "disputed_credit_holds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_disputes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_disputes_token_purchase_id_fkey"
            columns: ["token_purchase_id"]
            isOneToOne: false
            referencedRelation: "token_purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      pod_milestones: {
        Row: {
          breach_detected_at: string | null
          completed_at: string | null
          depends_on: string | null
          detected_deficiency_at: string | null
          due_at: string
          evidence_document_id: string | null
          grace_period_ends_at: string | null
          id: string
          name: string
          org_id: string
          overdue_notified_at: string | null
          pod_id: string
          sequence_order: number | null
          status: string
        }
        Insert: {
          breach_detected_at?: string | null
          completed_at?: string | null
          depends_on?: string | null
          detected_deficiency_at?: string | null
          due_at: string
          evidence_document_id?: string | null
          grace_period_ends_at?: string | null
          id?: string
          name: string
          org_id: string
          overdue_notified_at?: string | null
          pod_id: string
          sequence_order?: number | null
          status?: string
        }
        Update: {
          breach_detected_at?: string | null
          completed_at?: string | null
          depends_on?: string | null
          detected_deficiency_at?: string | null
          due_at?: string
          evidence_document_id?: string | null
          grace_period_ends_at?: string | null
          id?: string
          name?: string
          org_id?: string
          overdue_notified_at?: string | null
          pod_id?: string
          sequence_order?: number | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "pod_milestones_depends_on_fkey"
            columns: ["depends_on"]
            isOneToOne: false
            referencedRelation: "pod_milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pod_milestones_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pod_milestones_pod_id_fkey"
            columns: ["pod_id"]
            isOneToOne: false
            referencedRelation: "pods"
            referencedColumns: ["id"]
          },
        ]
      }
      pods: {
        Row: {
          created_at: string
          finalised_at: string | null
          id: string
          org_id: string
          state: string
          wad_id: string
        }
        Insert: {
          created_at?: string
          finalised_at?: string | null
          id?: string
          org_id: string
          state?: string
          wad_id: string
        }
        Update: {
          created_at?: string
          finalised_at?: string | null
          id?: string
          org_id?: string
          state?: string
          wad_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pods_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pods_wad_id_fkey"
            columns: ["wad_id"]
            isOneToOne: false
            referencedRelation: "p3_wads"
            referencedColumns: ["id"]
          },
        ]
      }
      poi_engagements: {
        Row: {
          admin_notes: string | null
          binding_candidates: Json | null
          binding_resolution: string | null
          cancelled_at: string | null
          cancelled_by_user_id: string | null
          cancelled_reason: string | null
          contact_date: string | null
          contact_method: string | null
          contact_name: string | null
          contact_type: string | null
          contacted_at: string | null
          counterparty_email: string | null
          counterparty_org_id: string | null
          counterparty_response: string | null
          counterparty_type: Database["public"]["Enums"]["counterparty_type"]
          created_at: string
          demo_dataset_id: string | null
          dispute_metadata: Json | null
          dispute_reason: string | null
          dispute_source: string | null
          disputed_at: string | null
          disputed_by_token_hash: string | null
          engagement_status: Database["public"]["Enums"]["engagement_status"]
          expires_at: string
          id: string
          is_demo: boolean
          late_acceptance_recorded_at: string | null
          late_acceptance_resolution: string | null
          late_acceptance_resolved_at: string | null
          match_id: string
          operational_state: string | null
          operational_state_set_at: string | null
          operational_state_set_by: string | null
          org_id: string
          original_expired_at: string | null
          reconfirmation_window_expires_at: string | null
          reconfirmed_at: string | null
          reconfirmed_by_user_id: string | null
          renewed_engagement_id: string | null
          renewed_from_engagement_id: string | null
          replacement_engagement_id: string | null
          responded_at: string | null
          sla_reminder_count: number
          sla_reminder_sent_at: string | null
          source: string
          superseded_by_engagement_id: string | null
          support_notes: string | null
          support_notes_updated_at: string | null
          support_notes_updated_by: string | null
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          binding_candidates?: Json | null
          binding_resolution?: string | null
          cancelled_at?: string | null
          cancelled_by_user_id?: string | null
          cancelled_reason?: string | null
          contact_date?: string | null
          contact_method?: string | null
          contact_name?: string | null
          contact_type?: string | null
          contacted_at?: string | null
          counterparty_email?: string | null
          counterparty_org_id?: string | null
          counterparty_response?: string | null
          counterparty_type?: Database["public"]["Enums"]["counterparty_type"]
          created_at?: string
          demo_dataset_id?: string | null
          dispute_metadata?: Json | null
          dispute_reason?: string | null
          dispute_source?: string | null
          disputed_at?: string | null
          disputed_by_token_hash?: string | null
          engagement_status?: Database["public"]["Enums"]["engagement_status"]
          expires_at?: string
          id?: string
          is_demo?: boolean
          late_acceptance_recorded_at?: string | null
          late_acceptance_resolution?: string | null
          late_acceptance_resolved_at?: string | null
          match_id: string
          operational_state?: string | null
          operational_state_set_at?: string | null
          operational_state_set_by?: string | null
          org_id: string
          original_expired_at?: string | null
          reconfirmation_window_expires_at?: string | null
          reconfirmed_at?: string | null
          reconfirmed_by_user_id?: string | null
          renewed_engagement_id?: string | null
          renewed_from_engagement_id?: string | null
          replacement_engagement_id?: string | null
          responded_at?: string | null
          sla_reminder_count?: number
          sla_reminder_sent_at?: string | null
          source?: string
          superseded_by_engagement_id?: string | null
          support_notes?: string | null
          support_notes_updated_at?: string | null
          support_notes_updated_by?: string | null
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          binding_candidates?: Json | null
          binding_resolution?: string | null
          cancelled_at?: string | null
          cancelled_by_user_id?: string | null
          cancelled_reason?: string | null
          contact_date?: string | null
          contact_method?: string | null
          contact_name?: string | null
          contact_type?: string | null
          contacted_at?: string | null
          counterparty_email?: string | null
          counterparty_org_id?: string | null
          counterparty_response?: string | null
          counterparty_type?: Database["public"]["Enums"]["counterparty_type"]
          created_at?: string
          demo_dataset_id?: string | null
          dispute_metadata?: Json | null
          dispute_reason?: string | null
          dispute_source?: string | null
          disputed_at?: string | null
          disputed_by_token_hash?: string | null
          engagement_status?: Database["public"]["Enums"]["engagement_status"]
          expires_at?: string
          id?: string
          is_demo?: boolean
          late_acceptance_recorded_at?: string | null
          late_acceptance_resolution?: string | null
          late_acceptance_resolved_at?: string | null
          match_id?: string
          operational_state?: string | null
          operational_state_set_at?: string | null
          operational_state_set_by?: string | null
          org_id?: string
          original_expired_at?: string | null
          reconfirmation_window_expires_at?: string | null
          reconfirmed_at?: string | null
          reconfirmed_by_user_id?: string | null
          renewed_engagement_id?: string | null
          renewed_from_engagement_id?: string | null
          replacement_engagement_id?: string | null
          responded_at?: string | null
          sla_reminder_count?: number
          sla_reminder_sent_at?: string | null
          source?: string
          superseded_by_engagement_id?: string | null
          support_notes?: string | null
          support_notes_updated_at?: string | null
          support_notes_updated_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "poi_engagements_counterparty_org_id_fkey"
            columns: ["counterparty_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poi_engagements_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "match_evidence"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "poi_engagements_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poi_engagements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poi_engagements_renewed_engagement_id_fkey"
            columns: ["renewed_engagement_id"]
            isOneToOne: false
            referencedRelation: "engagement_email_sent_but_status_stuck"
            referencedColumns: ["engagement_id"]
          },
          {
            foreignKeyName: "poi_engagements_renewed_engagement_id_fkey"
            columns: ["renewed_engagement_id"]
            isOneToOne: false
            referencedRelation: "poi_engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poi_engagements_renewed_from_engagement_id_fkey"
            columns: ["renewed_from_engagement_id"]
            isOneToOne: false
            referencedRelation: "engagement_email_sent_but_status_stuck"
            referencedColumns: ["engagement_id"]
          },
          {
            foreignKeyName: "poi_engagements_renewed_from_engagement_id_fkey"
            columns: ["renewed_from_engagement_id"]
            isOneToOne: false
            referencedRelation: "poi_engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poi_engagements_replacement_fk"
            columns: ["replacement_engagement_id"]
            isOneToOne: false
            referencedRelation: "engagement_email_sent_but_status_stuck"
            referencedColumns: ["engagement_id"]
          },
          {
            foreignKeyName: "poi_engagements_replacement_fk"
            columns: ["replacement_engagement_id"]
            isOneToOne: false
            referencedRelation: "poi_engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poi_engagements_superseded_by_engagement_id_fkey"
            columns: ["superseded_by_engagement_id"]
            isOneToOne: false
            referencedRelation: "engagement_email_sent_but_status_stuck"
            referencedColumns: ["engagement_id"]
          },
          {
            foreignKeyName: "poi_engagements_superseded_by_engagement_id_fkey"
            columns: ["superseded_by_engagement_id"]
            isOneToOne: false
            referencedRelation: "poi_engagements"
            referencedColumns: ["id"]
          },
        ]
      }
      poi_events: {
        Row: {
          actor_api_key_id: string | null
          actor_user_id: string | null
          created_at: string
          from_state: string
          id: string
          match_id: string
          metadata: Json | null
          org_id: string
          reason: string | null
          to_state: string
        }
        Insert: {
          actor_api_key_id?: string | null
          actor_user_id?: string | null
          created_at?: string
          from_state: string
          id?: string
          match_id: string
          metadata?: Json | null
          org_id: string
          reason?: string | null
          to_state: string
        }
        Update: {
          actor_api_key_id?: string | null
          actor_user_id?: string | null
          created_at?: string
          from_state?: string
          id?: string
          match_id?: string
          metadata?: Json | null
          org_id?: string
          reason?: string | null
          to_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "poi_events_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "match_evidence"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "poi_events_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poi_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pois: {
        Row: {
          buyer_entity_id: string
          completion_probability: number | null
          created_at: string
          demo_dataset_id: string | null
          id: string
          industry_code: string
          is_demo: boolean
          jurisdiction_code: string
          last_activity_at: string
          org_id: string
          poi_type: string
          seller_entity_id: string | null
          state: string
          terms: Json
        }
        Insert: {
          buyer_entity_id: string
          completion_probability?: number | null
          created_at?: string
          demo_dataset_id?: string | null
          id?: string
          industry_code: string
          is_demo?: boolean
          jurisdiction_code: string
          last_activity_at?: string
          org_id: string
          poi_type?: string
          seller_entity_id?: string | null
          state?: string
          terms?: Json
        }
        Update: {
          buyer_entity_id?: string
          completion_probability?: number | null
          created_at?: string
          demo_dataset_id?: string | null
          id?: string
          industry_code?: string
          is_demo?: boolean
          jurisdiction_code?: string
          last_activity_at?: string
          org_id?: string
          poi_type?: string
          seller_entity_id?: string | null
          state?: string
          terms?: Json
        }
        Relationships: [
          {
            foreignKeyName: "pois_buyer_entity_id_fkey"
            columns: ["buyer_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pois_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pois_seller_entity_id_fkey"
            columns: ["seller_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          deletion_category: string | null
          deletion_reason: string | null
          deletion_requested_at: string | null
          demo_dataset_id: string | null
          email: string
          full_name: string | null
          full_name_previous: string | null
          id: string
          is_demo: boolean
          org_id: string
          selected_persona: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deletion_category?: string | null
          deletion_reason?: string | null
          deletion_requested_at?: string | null
          demo_dataset_id?: string | null
          email: string
          full_name?: string | null
          full_name_previous?: string | null
          id: string
          is_demo?: boolean
          org_id: string
          selected_persona?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deletion_category?: string | null
          deletion_reason?: string | null
          deletion_requested_at?: string | null
          demo_dataset_id?: string | null
          email?: string
          full_name?: string | null
          full_name_previous?: string | null
          id?: string
          is_demo?: boolean
          org_id?: string
          selected_persona?: string | null
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
      programme_milestones: {
        Row: {
          budget_tranche: number
          completed_at: string | null
          created_at: string
          due_at: string
          evidence_document_id: string | null
          id: string
          name: string
          participant_id: string
          programme_id: string
          status: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          budget_tranche?: number
          completed_at?: string | null
          created_at?: string
          due_at: string
          evidence_document_id?: string | null
          id?: string
          name: string
          participant_id: string
          programme_id: string
          status?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          budget_tranche?: number
          completed_at?: string | null
          created_at?: string
          due_at?: string
          evidence_document_id?: string | null
          id?: string
          name?: string
          participant_id?: string
          programme_id?: string
          status?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "programme_milestones_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "programme_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "programme_milestones_programme_id_fkey"
            columns: ["programme_id"]
            isOneToOne: false
            referencedRelation: "programmes"
            referencedColumns: ["id"]
          },
        ]
      }
      programme_participants: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          contact_completeness_state: string
          created_at: string
          email: string | null
          entity_id: string
          id: string
          manual_follow_up_reason: string | null
          notes: string | null
          phone: string | null
          programme_id: string
          role: string
          status: string
          trade_approval_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          contact_completeness_state?: string
          created_at?: string
          email?: string | null
          entity_id: string
          id?: string
          manual_follow_up_reason?: string | null
          notes?: string | null
          phone?: string | null
          programme_id: string
          role?: string
          status?: string
          trade_approval_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          contact_completeness_state?: string
          created_at?: string
          email?: string | null
          entity_id?: string
          id?: string
          manual_follow_up_reason?: string | null
          notes?: string | null
          phone?: string | null
          programme_id?: string
          role?: string
          status?: string
          trade_approval_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "programme_participants_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "programme_participants_programme_id_fkey"
            columns: ["programme_id"]
            isOneToOne: false
            referencedRelation: "programmes"
            referencedColumns: ["id"]
          },
        ]
      }
      programmes: {
        Row: {
          budget_allocated: number
          budget_committed: number
          budget_disbursed: number
          created_at: string
          department: string
          fiscal_year: string
          id: string
          name: string
          objectives: Json | null
          org_id: string
          status: string
          updated_at: string
        }
        Insert: {
          budget_allocated?: number
          budget_committed?: number
          budget_disbursed?: number
          created_at?: string
          department: string
          fiscal_year: string
          id?: string
          name: string
          objectives?: Json | null
          org_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          budget_allocated?: number
          budget_committed?: number
          budget_disbursed?: number
          created_at?: string
          department?: string
          fiscal_year?: string
          id?: string
          name?: string
          objectives?: Json | null
          org_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "programmes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_retry_state: {
        Row: {
          cooldown_until: string | null
          created_at: string
          entity_id: string | null
          failure_count: number
          gate: string
          id: string
          last_failure_at: string
          org_id: string | null
          provider: string
          scope_key: string
          updated_at: string
        }
        Insert: {
          cooldown_until?: string | null
          created_at?: string
          entity_id?: string | null
          failure_count?: number
          gate: string
          id?: string
          last_failure_at?: string
          org_id?: string | null
          provider: string
          scope_key: string
          updated_at?: string
        }
        Update: {
          cooldown_until?: string | null
          created_at?: string
          entity_id?: string | null
          failure_count?: number
          gate?: string
          id?: string
          last_failure_at?: string
          org_id?: string | null
          provider?: string
          scope_key?: string
          updated_at?: string
        }
        Relationships: []
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
      rating_appeals: {
        Row: {
          created_at: string
          filed_by_user_id: string
          id: string
          org_id: string
          rating_snapshot: Json
          reason: string
          resolution_notes: string | null
          resolved_at: string | null
          reviewing_admin_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          filed_by_user_id: string
          id?: string
          org_id: string
          rating_snapshot: Json
          reason: string
          resolution_notes?: string | null
          resolved_at?: string | null
          reviewing_admin_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          filed_by_user_id?: string
          id?: string
          org_id?: string
          rating_snapshot?: Json
          reason?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          reviewing_admin_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rating_appeals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      rating_methodology_versions: {
        Row: {
          active: boolean
          created_at: string
          decay_half_life_days: number
          id: string
          min_sample_size: number
          notes: string | null
          recent_weight: number
          recent_window_days: number
          version: number
          weights: Json
        }
        Insert: {
          active?: boolean
          created_at?: string
          decay_half_life_days?: number
          id?: string
          min_sample_size?: number
          notes?: string | null
          recent_weight?: number
          recent_window_days?: number
          version: number
          weights: Json
        }
        Update: {
          active?: boolean
          created_at?: string
          decay_half_life_days?: number
          id?: string
          min_sample_size?: number
          notes?: string | null
          recent_weight?: number
          recent_window_days?: number
          version?: number
          weights?: Json
        }
        Relationships: []
      }
      rating_signals: {
        Row: {
          decay_factor: number
          id: string
          metadata: Json
          methodology_version: number
          normalized_value: number | null
          observed_at: string
          org_id: string
          pillar: string
          raw_value: number | null
          recorded_at: string
          signal_type: string
          source_entity_id: string | null
          source_entity_type: string | null
          weight: number
        }
        Insert: {
          decay_factor?: number
          id?: string
          metadata?: Json
          methodology_version: number
          normalized_value?: number | null
          observed_at: string
          org_id: string
          pillar: string
          raw_value?: number | null
          recorded_at?: string
          signal_type: string
          source_entity_id?: string | null
          source_entity_type?: string | null
          weight?: number
        }
        Update: {
          decay_factor?: number
          id?: string
          metadata?: Json
          methodology_version?: number
          normalized_value?: number | null
          observed_at?: string
          org_id?: string
          pillar?: string
          raw_value?: number | null
          recorded_at?: string
          signal_type?: string
          source_entity_id?: string | null
          source_entity_type?: string | null
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "rating_signals_methodology_version_fkey"
            columns: ["methodology_version"]
            isOneToOne: false
            referencedRelation: "rating_methodology_versions"
            referencedColumns: ["version"]
          },
          {
            foreignKeyName: "rating_signals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      refund_requests: {
        Row: {
          created_at: string
          credits_at_request: number
          credits_used_at_request: number
          decision_reason: string | null
          id: string
          ledger_adjustment_id: string | null
          metadata: Json
          org_id: string
          reason_code: string
          reason_detail: string
          requested_by: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          token_purchase_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          credits_at_request: number
          credits_used_at_request: number
          decision_reason?: string | null
          id?: string
          ledger_adjustment_id?: string | null
          metadata?: Json
          org_id: string
          reason_code: string
          reason_detail: string
          requested_by: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          token_purchase_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          credits_at_request?: number
          credits_used_at_request?: number
          decision_reason?: string | null
          id?: string
          ledger_adjustment_id?: string | null
          metadata?: Json
          org_id?: string
          reason_code?: string
          reason_detail?: string
          requested_by?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          token_purchase_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refund_requests_ledger_adjustment_id_fkey"
            columns: ["ledger_adjustment_id"]
            isOneToOne: false
            referencedRelation: "token_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_requests_ledger_adjustment_id_fkey"
            columns: ["ledger_adjustment_id"]
            isOneToOne: false
            referencedRelation: "v_poi_burn_reconciliation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_requests_token_purchase_id_fkey"
            columns: ["token_purchase_id"]
            isOneToOne: false
            referencedRelation: "token_purchases"
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
      retention_flags: {
        Row: {
          archive_hash: string | null
          archive_size_bytes: number | null
          archive_storage_path: string | null
          archived_at: string | null
          enforcement_applied_at: string | null
          enforcement_applied_by: string | null
          enforcement_audit_id: string | null
          flag_type: string
          flagged_at: string
          id: string
          last_scan_at: string | null
          org_id: string | null
          record_created_at: string
          record_id: string
          resolution_note: string | null
          resolution_status: string | null
          resolved_at: string | null
          resolved_by: string | null
          retention_action: string | null
          retention_expires_at: string
          retention_status: string
          table_name: string
        }
        Insert: {
          archive_hash?: string | null
          archive_size_bytes?: number | null
          archive_storage_path?: string | null
          archived_at?: string | null
          enforcement_applied_at?: string | null
          enforcement_applied_by?: string | null
          enforcement_audit_id?: string | null
          flag_type?: string
          flagged_at?: string
          id?: string
          last_scan_at?: string | null
          org_id?: string | null
          record_created_at: string
          record_id: string
          resolution_note?: string | null
          resolution_status?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          retention_action?: string | null
          retention_expires_at: string
          retention_status?: string
          table_name: string
        }
        Update: {
          archive_hash?: string | null
          archive_size_bytes?: number | null
          archive_storage_path?: string | null
          archived_at?: string | null
          enforcement_applied_at?: string | null
          enforcement_applied_by?: string | null
          enforcement_audit_id?: string | null
          flag_type?: string
          flagged_at?: string
          id?: string
          last_scan_at?: string | null
          org_id?: string | null
          record_created_at?: string
          record_id?: string
          resolution_note?: string | null
          resolution_status?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          retention_action?: string | null
          retention_expires_at?: string
          retention_status?: string
          table_name?: string
        }
        Relationships: []
      }
      retention_run_evidence: {
        Row: {
          created_at: string
          decision: string | null
          details: Json
          finished_at: string | null
          id: string
          job_name: string
          org_id: string | null
          reason: string | null
          record_class: string
          rows_eligible: number
          rows_purged: number
          rows_seen: number
          rows_skipped_disabled_policy: number
          rows_skipped_error: number
          rows_skipped_invalid_policy: number
          rows_skipped_legal_hold: number
          rows_skipped_missing_policy: number
          run_id: string
          started_at: string
          status: string
        }
        Insert: {
          created_at?: string
          decision?: string | null
          details?: Json
          finished_at?: string | null
          id?: string
          job_name: string
          org_id?: string | null
          reason?: string | null
          record_class: string
          rows_eligible?: number
          rows_purged?: number
          rows_seen?: number
          rows_skipped_disabled_policy?: number
          rows_skipped_error?: number
          rows_skipped_invalid_policy?: number
          rows_skipped_legal_hold?: number
          rows_skipped_missing_policy?: number
          run_id: string
          started_at: string
          status: string
        }
        Update: {
          created_at?: string
          decision?: string | null
          details?: Json
          finished_at?: string | null
          id?: string
          job_name?: string
          org_id?: string | null
          reason?: string | null
          record_class?: string
          rows_eligible?: number
          rows_purged?: number
          rows_seen?: number
          rows_skipped_disabled_policy?: number
          rows_skipped_error?: number
          rows_skipped_invalid_policy?: number
          rows_skipped_legal_hold?: number
          rows_skipped_missing_policy?: number
          run_id?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      revenue_notification_audit: {
        Row: {
          created_at: string
          details: Json
          error_message: string | null
          event_type: string
          id: string
          idempotency_key: string
          org_id: string | null
          org_name: string | null
          recipient_email: string
          reference_id: string | null
          status: Database["public"]["Enums"]["revenue_notification_status"]
        }
        Insert: {
          created_at?: string
          details?: Json
          error_message?: string | null
          event_type: string
          id?: string
          idempotency_key: string
          org_id?: string | null
          org_name?: string | null
          recipient_email: string
          reference_id?: string | null
          status: Database["public"]["Enums"]["revenue_notification_status"]
        }
        Update: {
          created_at?: string
          details?: Json
          error_message?: string | null
          event_type?: string
          id?: string
          idempotency_key?: string
          org_id?: string | null
          org_name?: string | null
          recipient_email?: string
          reference_id?: string | null
          status?: Database["public"]["Enums"]["revenue_notification_status"]
        }
        Relationships: []
      }
      risk_snapshots: {
        Row: {
          created_at: string
          entity_id: string
          id: string
          inputs: Json
          org_id: string
          risk_band: string
          risk_score: number
        }
        Insert: {
          created_at?: string
          entity_id: string
          id?: string
          inputs?: Json
          org_id: string
          risk_band: string
          risk_score: number
        }
        Update: {
          created_at?: string
          entity_id?: string
          id?: string
          inputs?: Json
          org_id?: string
          risk_band?: string
          risk_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "risk_snapshots_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risk_snapshots_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      screening_results: {
        Row: {
          created_at: string
          demo_dataset_id: string | null
          entity_id: string | null
          id: string
          is_demo: boolean
          matched_entities: Json | null
          metadata: Json
          next_screening_at: string | null
          org_id: string
          provider: string
          provider_config: Json | null
          raw_response: Json | null
          response_hash: string | null
          screened_at: string
          screened_by: string | null
          screening_type: string
          status: string
        }
        Insert: {
          created_at?: string
          demo_dataset_id?: string | null
          entity_id?: string | null
          id?: string
          is_demo?: boolean
          matched_entities?: Json | null
          metadata?: Json
          next_screening_at?: string | null
          org_id: string
          provider?: string
          provider_config?: Json | null
          raw_response?: Json | null
          response_hash?: string | null
          screened_at?: string
          screened_by?: string | null
          screening_type: string
          status?: string
        }
        Update: {
          created_at?: string
          demo_dataset_id?: string | null
          entity_id?: string | null
          id?: string
          is_demo?: boolean
          matched_entities?: Json | null
          metadata?: Json
          next_screening_at?: string | null
          org_id?: string
          provider?: string
          provider_config?: Json | null
          raw_response?: Json | null
          response_hash?: string | null
          screened_at?: string
          screened_by?: string | null
          screening_type?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "screening_results_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screening_results_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      screening_runs: {
        Row: {
          demo_dataset_id: string | null
          details: Json | null
          entity_id: string
          id: string
          is_demo: boolean
          org_id: string
          provider: string
          ran_at: string
          response_hash: string
          status: string
        }
        Insert: {
          demo_dataset_id?: string | null
          details?: Json | null
          entity_id: string
          id?: string
          is_demo?: boolean
          org_id: string
          provider: string
          ran_at?: string
          response_hash: string
          status: string
        }
        Update: {
          demo_dataset_id?: string | null
          details?: Json | null
          entity_id?: string
          id?: string
          is_demo?: boolean
          org_id?: string
          provider?: string
          ran_at?: string
          response_hash?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "screening_runs_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screening_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
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
            referencedRelation: "account_hard_delete_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "selections_selected_by_fkey"
            columns: ["selected_by"]
            isOneToOne: false
            referencedRelation: "org_colleagues_v"
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
            foreignKeyName: "selections_selected_by_fkey"
            columns: ["selected_by"]
            isOneToOne: false
            referencedRelation: "profiles_safe"
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
      sentry_heartbeats: {
        Row: {
          dsn_configured: boolean
          id: boolean
          last_attempt_at: string | null
          last_error: string | null
          last_event_id: string | null
          last_http_status: number | null
          last_status: string
          last_success_at: string | null
          updated_at: string
        }
        Insert: {
          dsn_configured?: boolean
          id?: boolean
          last_attempt_at?: string | null
          last_error?: string | null
          last_event_id?: string | null
          last_http_status?: number | null
          last_status?: string
          last_success_at?: string | null
          updated_at?: string
        }
        Update: {
          dsn_configured?: boolean
          id?: boolean
          last_attempt_at?: string | null
          last_error?: string | null
          last_event_id?: string | null
          last_http_status?: number | null
          last_status?: string
          last_success_at?: string | null
          updated_at?: string
        }
        Relationships: []
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
            referencedRelation: "account_hard_delete_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "signals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "org_colleagues_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles_safe"
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
      signing_keys: {
        Row: {
          algorithm: string
          created_at: string
          created_by: string | null
          id: string
          key_id: string
          org_id: string
          public_key_jwk: Json
          revoked_at: string | null
          revoked_by: string | null
          revoked_reason: string | null
          rotated_to: string | null
          status: string
        }
        Insert: {
          algorithm?: string
          created_at?: string
          created_by?: string | null
          id?: string
          key_id: string
          org_id: string
          public_key_jwk: Json
          revoked_at?: string | null
          revoked_by?: string | null
          revoked_reason?: string | null
          rotated_to?: string | null
          status?: string
        }
        Update: {
          algorithm?: string
          created_at?: string
          created_by?: string | null
          id?: string
          key_id?: string
          org_id?: string
          public_key_jwk?: Json
          revoked_at?: string | null
          revoked_by?: string | null
          revoked_reason?: string | null
          rotated_to?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "signing_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signing_keys_rotated_to_fkey"
            columns: ["rotated_to"]
            isOneToOne: false
            referencedRelation: "signing_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      staging_password_tokens: {
        Row: {
          consumed_at: string | null
          created_at: string
          created_by: string
          email: string
          expires_at: string
          id: string
          reveal_token_hash: string
          user_id: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          created_by: string
          email: string
          expires_at: string
          id?: string
          reveal_token_hash: string
          user_id: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          created_by?: string
          email?: string
          expires_at?: string
          id?: string
          reveal_token_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      storage_deletion_queue: {
        Row: {
          bucket_id: string
          created_at: string
          error_message: string | null
          file_path: string
          id: string
          scheduled_for: string
          source_record_id: string | null
          source_table: string
          status: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          error_message?: string | null
          file_path: string
          id?: string
          scheduled_for?: string
          source_record_id?: string | null
          source_table: string
          status?: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          error_message?: string | null
          file_path?: string
          id?: string
          scheduled_for?: string
          source_record_id?: string | null
          source_table?: string
          status?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      team_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string | null
          email: string
          expires_at: string | null
          id: string
          invited_by: string
          org_id: string
          role: string | null
          status: string | null
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string | null
          email: string
          expires_at?: string | null
          id?: string
          invited_by: string
          org_id: string
          role?: string | null
          status?: string | null
        }
        Update: {
          accepted_at?: string | null
          created_at?: string | null
          email?: string
          expires_at?: string | null
          id?: string
          invited_by?: string
          org_id?: string
          role?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_invitations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_boundary_allowlist: {
        Row: {
          added_at: string
          added_by: string | null
          reason: string
          table_name: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          reason: string
          table_name: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          reason?: string
          table_name?: string
        }
        Relationships: []
      }
      tenant_boundary_evidence: {
        Row: {
          created_at: string
          critical_count: number
          high_count: number
          id: string
          manifest_sha256: string
          results: Json
          run_at: string
          run_by: string | null
          run_id: string
          schema_hash: string
          status: string
          tables_allowlisted: number
          tables_failed: number
          tables_passed: number
          tables_total: number
        }
        Insert: {
          created_at?: string
          critical_count?: number
          high_count?: number
          id?: string
          manifest_sha256: string
          results: Json
          run_at?: string
          run_by?: string | null
          run_id: string
          schema_hash: string
          status: string
          tables_allowlisted?: number
          tables_failed?: number
          tables_passed?: number
          tables_total?: number
        }
        Update: {
          created_at?: string
          critical_count?: number
          high_count?: number
          id?: string
          manifest_sha256?: string
          results?: Json
          run_at?: string
          run_by?: string | null
          run_id?: string
          schema_hash?: string
          status?: string
          tables_allowlisted?: number
          tables_failed?: number
          tables_passed?: number
          tables_total?: number
        }
        Relationships: []
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
          action_type: string
          api_key_id: string | null
          created_at: string
          demo_dataset_id: string | null
          endpoint: string
          entity_id: string | null
          id: string
          is_demo: boolean
          metadata: Json | null
          org_id: string
          outcome: string
          remaining_balance: number
          request_id: string | null
          tokens_burned: number
        }
        Insert: {
          action_type: string
          api_key_id?: string | null
          created_at?: string
          demo_dataset_id?: string | null
          endpoint: string
          entity_id?: string | null
          id?: string
          is_demo?: boolean
          metadata?: Json | null
          org_id: string
          outcome: string
          remaining_balance: number
          request_id?: string | null
          tokens_burned?: number
        }
        Update: {
          action_type?: string
          api_key_id?: string | null
          created_at?: string
          demo_dataset_id?: string | null
          endpoint?: string
          entity_id?: string | null
          id?: string
          is_demo?: boolean
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
      token_purchases: {
        Row: {
          amount_usd: number
          created_at: string
          currency: string
          id: string
          metadata: Json
          org_id: string
          package_id: string
          paystack_reference: string
          status: string
          token_amount: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          amount_usd: number
          created_at?: string
          currency?: string
          id?: string
          metadata?: Json
          org_id: string
          package_id: string
          paystack_reference: string
          status?: string
          token_amount: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          amount_usd?: number
          created_at?: string
          currency?: string
          id?: string
          metadata?: Json
          org_id?: string
          package_id?: string
          paystack_reference?: string
          status?: string
          token_amount?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "token_purchases_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      token_transactions: {
        Row: {
          amount: number
          balance_after: number
          balance_before: number
          created_at: string
          governance_doc_id: string | null
          id: string
          idempotency_key: string
          org_id: string
          type: string
          wallet_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          balance_before: number
          created_at?: string
          governance_doc_id?: string | null
          id?: string
          idempotency_key: string
          org_id: string
          type: string
          wallet_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          balance_before?: number
          created_at?: string
          governance_doc_id?: string | null
          id?: string
          idempotency_key?: string
          org_id?: string
          type?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "token_transactions_governance_doc_id_fkey"
            columns: ["governance_doc_id"]
            isOneToOne: false
            referencedRelation: "governance_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "token_transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "token_transactions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "token_wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      token_wallets: {
        Row: {
          balance: number
          entity_id: string
          id: string
          org_id: string
          updated_at: string
        }
        Insert: {
          balance?: number
          entity_id: string
          id?: string
          org_id: string
          updated_at?: string
        }
        Update: {
          balance?: number
          entity_id?: string
          id?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "token_wallets_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "token_wallets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_approvals: {
        Row: {
          approval_request_id: string | null
          approved_at: string | null
          approved_by: string | null
          created_at: string
          id: string
          org_id: string
          risk_band: string | null
          status: string
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          approval_request_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          org_id: string
          risk_band?: string | null
          status?: string
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          approval_request_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          org_id?: string
          risk_band?: string | null
          status?: string
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trade_approvals_approval_request_id_fkey"
            columns: ["approval_request_id"]
            isOneToOne: false
            referencedRelation: "dd_approval_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_approvals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_orders: {
        Row: {
          additional_info: string | null
          created_at: string
          expires_at: string | null
          id: string
          location: string | null
          org_id: string
          price: number | null
          price_currency: string | null
          product: string
          side: string
          status: string
          updated_at: string
          user_id: string
          volume: number | null
          volume_unit: string | null
        }
        Insert: {
          additional_info?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          location?: string | null
          org_id: string
          price?: number | null
          price_currency?: string | null
          product: string
          side: string
          status?: string
          updated_at?: string
          user_id: string
          volume?: number | null
          volume_unit?: string | null
        }
        Update: {
          additional_info?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          location?: string | null
          org_id?: string
          price?: number | null
          price_currency?: string | null
          product?: string
          side?: string
          status?: string
          updated_at?: string
          user_id?: string
          volume?: number | null
          volume_unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trade_orders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_requests: {
        Row: {
          archive_mode: string | null
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          commodity: string | null
          created_at: string
          created_by: string
          demo_dataset_id: string | null
          id: string
          is_demo: boolean
          location: string | null
          match_type: string | null
          metadata: Json | null
          org_id: string
          price_amount: number | null
          price_currency: string | null
          quantity_amount: number | null
          quantity_unit: string | null
          side: string | null
          status: string
          updated_at: string
        }
        Insert: {
          archive_mode?: string | null
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          commodity?: string | null
          created_at?: string
          created_by: string
          demo_dataset_id?: string | null
          id?: string
          is_demo?: boolean
          location?: string | null
          match_type?: string | null
          metadata?: Json | null
          org_id: string
          price_amount?: number | null
          price_currency?: string | null
          quantity_amount?: number | null
          quantity_unit?: string | null
          side?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          archive_mode?: string | null
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          commodity?: string | null
          created_at?: string
          created_by?: string
          demo_dataset_id?: string | null
          id?: string
          is_demo?: boolean
          location?: string | null
          match_type?: string | null
          metadata?: Json | null
          org_id?: string
          price_amount?: number | null
          price_currency?: string | null
          quantity_amount?: number | null
          quantity_unit?: string | null
          side?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ubo_links: {
        Row: {
          company_entity_id: string
          created_at: string
          document_id: string | null
          expires_at: string | null
          id: string
          org_id: string
          ownership_percentage: number
          person_entity_id: string
          status: string
          updated_at: string
          verification_method: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          company_entity_id: string
          created_at?: string
          document_id?: string | null
          expires_at?: string | null
          id?: string
          org_id: string
          ownership_percentage: number
          person_entity_id: string
          status?: string
          updated_at?: string
          verification_method?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          company_entity_id?: string
          created_at?: string
          document_id?: string | null
          expires_at?: string | null
          id?: string
          org_id?: string
          ownership_percentage?: number
          person_entity_id?: string
          status?: string
          updated_at?: string
          verification_method?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ubo_links_company_entity_id_fkey"
            columns: ["company_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ubo_links_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ubo_links_person_entity_id_fkey"
            columns: ["person_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      user_export_requests: {
        Row: {
          block_reason: string | null
          created_at: string
          expires_at: string | null
          id: string
          org_id: string | null
          request_metadata: Json
          requested_at: string
          requested_categories: string[]
          resolved_categories: string[]
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          block_reason?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          org_id?: string | null
          request_metadata?: Json
          requested_at?: string
          requested_categories?: string[]
          resolved_categories?: string[]
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          block_reason?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          org_id?: string | null
          request_metadata?: Json
          requested_at?: string
          requested_categories?: string[]
          resolved_categories?: string[]
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
      vault_documents: {
        Row: {
          case_id: string | null
          classification: string
          doc_type: string
          id: string
          org_id: string
          owner_entity_id: string | null
          pod_id: string | null
          poi_id: string | null
          sha256_hash: string
          storage_uri: string
          uploaded_at: string
          uploaded_by: string | null
          wad_id: string | null
        }
        Insert: {
          case_id?: string | null
          classification?: string
          doc_type: string
          id?: string
          org_id: string
          owner_entity_id?: string | null
          pod_id?: string | null
          poi_id?: string | null
          sha256_hash: string
          storage_uri: string
          uploaded_at?: string
          uploaded_by?: string | null
          wad_id?: string | null
        }
        Update: {
          case_id?: string | null
          classification?: string
          doc_type?: string
          id?: string
          org_id?: string
          owner_entity_id?: string | null
          pod_id?: string | null
          poi_id?: string | null
          sha256_hash?: string
          storage_uri?: string
          uploaded_at?: string
          uploaded_by?: string | null
          wad_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vault_documents_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "compliance_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_documents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_documents_owner_entity_id_fkey"
            columns: ["owner_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_documents_pod_id_fkey"
            columns: ["pod_id"]
            isOneToOne: false
            referencedRelation: "pods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_documents_poi_id_fkey"
            columns: ["poi_id"]
            isOneToOne: false
            referencedRelation: "pois"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_documents_wad_id_fkey"
            columns: ["wad_id"]
            isOneToOne: false
            referencedRelation: "p3_wads"
            referencedColumns: ["id"]
          },
        ]
      }
      wad_attestations: {
        Row: {
          attestation_text: string
          attested_at: string
          attested_name: string
          id: string
          ip_address: string | null
          org_id: string
          role: string
          user_agent: string | null
          user_id: string
          wad_id: string
        }
        Insert: {
          attestation_text?: string
          attested_at?: string
          attested_name: string
          id?: string
          ip_address?: string | null
          org_id: string
          role: string
          user_agent?: string | null
          user_id: string
          wad_id: string
        }
        Update: {
          attestation_text?: string
          attested_at?: string
          attested_name?: string
          id?: string
          ip_address?: string | null
          org_id?: string
          role?: string
          user_agent?: string | null
          user_id?: string
          wad_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wad_attestations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wad_attestations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "account_hard_delete_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "wad_attestations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "org_colleagues_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wad_attestations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wad_attestations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wad_attestations_wad_id_fkey"
            columns: ["wad_id"]
            isOneToOne: false
            referencedRelation: "wads"
            referencedColumns: ["id"]
          },
        ]
      }
      wads: {
        Row: {
          buyer_org_id: string | null
          buyer_signatory_user_id: string | null
          canonical_payload_json: Json
          certificate_generated_at: string | null
          certificate_path: string | null
          created_at: string
          created_by: string | null
          demo_dataset_id: string | null
          evidence_bundle: Json
          id: string
          is_demo: boolean
          ledger_entry_hash: string | null
          org_id: string
          poi_id: string
          prev_ledger_entry_hash: string | null
          revoked_at: string | null
          revoked_by: string | null
          revoked_reason: string | null
          seal_hash: string | null
          sealed_at: string | null
          seller_org_id: string | null
          seller_signatory_user_id: string | null
          status: string
          superseded_by_wad_id: string | null
          supersedes_wad_id: string | null
          updated_at: string
        }
        Insert: {
          buyer_org_id?: string | null
          buyer_signatory_user_id?: string | null
          canonical_payload_json?: Json
          certificate_generated_at?: string | null
          certificate_path?: string | null
          created_at?: string
          created_by?: string | null
          demo_dataset_id?: string | null
          evidence_bundle?: Json
          id?: string
          is_demo?: boolean
          ledger_entry_hash?: string | null
          org_id: string
          poi_id: string
          prev_ledger_entry_hash?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          revoked_reason?: string | null
          seal_hash?: string | null
          sealed_at?: string | null
          seller_org_id?: string | null
          seller_signatory_user_id?: string | null
          status?: string
          superseded_by_wad_id?: string | null
          supersedes_wad_id?: string | null
          updated_at?: string
        }
        Update: {
          buyer_org_id?: string | null
          buyer_signatory_user_id?: string | null
          canonical_payload_json?: Json
          certificate_generated_at?: string | null
          certificate_path?: string | null
          created_at?: string
          created_by?: string | null
          demo_dataset_id?: string | null
          evidence_bundle?: Json
          id?: string
          is_demo?: boolean
          ledger_entry_hash?: string | null
          org_id?: string
          poi_id?: string
          prev_ledger_entry_hash?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          revoked_reason?: string | null
          seal_hash?: string | null
          sealed_at?: string | null
          seller_org_id?: string | null
          seller_signatory_user_id?: string | null
          status?: string
          superseded_by_wad_id?: string | null
          supersedes_wad_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wads_buyer_org_id_fkey"
            columns: ["buyer_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wads_buyer_signatory_user_id_fkey"
            columns: ["buyer_signatory_user_id"]
            isOneToOne: false
            referencedRelation: "account_hard_delete_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "wads_buyer_signatory_user_id_fkey"
            columns: ["buyer_signatory_user_id"]
            isOneToOne: false
            referencedRelation: "org_colleagues_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wads_buyer_signatory_user_id_fkey"
            columns: ["buyer_signatory_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wads_buyer_signatory_user_id_fkey"
            columns: ["buyer_signatory_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "account_hard_delete_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "wads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "org_colleagues_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wads_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wads_poi_id_fkey"
            columns: ["poi_id"]
            isOneToOne: false
            referencedRelation: "match_evidence"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "wads_poi_id_fkey"
            columns: ["poi_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wads_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "account_hard_delete_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "wads_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "org_colleagues_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wads_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wads_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wads_seller_org_id_fkey"
            columns: ["seller_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wads_seller_signatory_user_id_fkey"
            columns: ["seller_signatory_user_id"]
            isOneToOne: false
            referencedRelation: "account_hard_delete_status"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "wads_seller_signatory_user_id_fkey"
            columns: ["seller_signatory_user_id"]
            isOneToOne: false
            referencedRelation: "org_colleagues_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wads_seller_signatory_user_id_fkey"
            columns: ["seller_signatory_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wads_seller_signatory_user_id_fkey"
            columns: ["seller_signatory_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wads_superseded_by_wad_id_fkey"
            columns: ["superseded_by_wad_id"]
            isOneToOne: false
            referencedRelation: "wads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wads_supersedes_wad_id_fkey"
            columns: ["supersedes_wad_id"]
            isOneToOne: false
            referencedRelation: "wads"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_deliveries: {
        Row: {
          created_at: string
          delivered_at: string
          delivery_attempt: number
          error_message: string | null
          event_idempotency_key: string | null
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
          event_idempotency_key?: string | null
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
          event_idempotency_key?: string | null
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
          {
            foreignKeyName: "webhook_deliveries_webhook_endpoint_id_fkey"
            columns: ["webhook_endpoint_id"]
            isOneToOne: false
            referencedRelation: "webhook_endpoints_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_endpoints: {
        Row: {
          consecutive_failures: number
          created_at: string
          disabled_at: string | null
          events: string[]
          id: string
          is_primary: boolean
          last_delivery_at: string | null
          org_id: string
          previous_secret_expires_at: string | null
          previous_secret_hash: string | null
          secret_hash: string
          status: string
          updated_at: string
          url: string
        }
        Insert: {
          consecutive_failures?: number
          created_at?: string
          disabled_at?: string | null
          events?: string[]
          id?: string
          is_primary?: boolean
          last_delivery_at?: string | null
          org_id: string
          previous_secret_expires_at?: string | null
          previous_secret_hash?: string | null
          secret_hash: string
          status?: string
          updated_at?: string
          url: string
        }
        Update: {
          consecutive_failures?: number
          created_at?: string
          disabled_at?: string | null
          events?: string[]
          id?: string
          is_primary?: boolean
          last_delivery_at?: string | null
          org_id?: string
          previous_secret_expires_at?: string | null
          previous_secret_hash?: string | null
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
          demo_dataset_id: string | null
          error_message: string | null
          event_type: string
          id: string
          is_demo: boolean
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
          demo_dataset_id?: string | null
          error_message?: string | null
          event_type: string
          id?: string
          is_demo?: boolean
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
          demo_dataset_id?: string | null
          error_message?: string | null
          event_type?: string
          id?: string
          is_demo?: boolean
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
          {
            foreignKeyName: "webhook_events_webhook_endpoint_id_fkey"
            columns: ["webhook_endpoint_id"]
            isOneToOne: false
            referencedRelation: "webhook_endpoints_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_replay_guard: {
        Row: {
          id: number
          seen_at: string
          signature_hash: string
          source: string
        }
        Insert: {
          id?: number
          seen_at?: string
          signature_hash: string
          source: string
        }
        Update: {
          id?: number
          seen_at?: string
          signature_hash?: string
          source?: string
        }
        Relationships: []
      }
    }
    Views: {
      account_hard_delete_status: {
        Row: {
          days_pending: number | null
          deletion_category: string | null
          deletion_reason: string | null
          deletion_requested_at: string | null
          has_active_pois: boolean | null
          has_open_disputes: boolean | null
          is_platform_admin: boolean | null
          last_sweep_action: string | null
          last_sweep_at: string | null
          last_sweep_details: Json | null
          org_id: string | null
          placeholder_email: string | null
          sweep_state: string | null
          user_id: string | null
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
      discovery_baseline_metrics: {
        Row: {
          avg_fts_results: number | null
          avg_order_book_results: number | null
          avg_parse_tokens: number | null
          avg_response_ms: number | null
          avg_results: number | null
          day: string | null
          fallback_rate_pct: number | null
          fts_hit_rate_pct: number | null
          total_searches: number | null
        }
        Relationships: []
      }
      email_send_log_masked: {
        Row: {
          created_at: string | null
          error_message: string | null
          id: string | null
          message_id: string | null
          metadata: Json | null
          recipient_domain: string | null
          recipient_email_masked: string | null
          status: string | null
          template_name: string | null
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          id?: string | null
          message_id?: string | null
          metadata?: Json | null
          recipient_domain?: never
          recipient_email_masked?: never
          status?: string | null
          template_name?: string | null
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          id?: string | null
          message_id?: string | null
          metadata?: Json | null
          recipient_domain?: never
          recipient_email_masked?: never
          status?: string | null
          template_name?: string | null
        }
        Relationships: []
      }
      engagement_email_sent_but_status_stuck: {
        Row: {
          current_status: string | null
          engagement_id: string | null
          entry_type: string | null
          log_created_at: string | null
          match_id: string | null
          outreach_log_id: string | null
          recipient: string | null
        }
        Relationships: [
          {
            foreignKeyName: "poi_engagements_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "match_evidence"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "poi_engagements_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
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
      notification_skipped_24h_rollup: {
        Row: {
          first_seen: string | null
          last_seen: string | null
          reason: string | null
          skip_count: number | null
          source_function: string | null
        }
        Relationships: []
      }
      org_colleagues_v: {
        Row: {
          full_name: string | null
          id: string | null
          org_id: string | null
          selected_persona: string | null
          status: string | null
        }
        Insert: {
          full_name?: string | null
          id?: string | null
          org_id?: string | null
          selected_persona?: string | null
          status?: string | null
        }
        Update: {
          full_name?: string | null
          id?: string | null
          org_id?: string | null
          selected_persona?: string | null
          status?: string | null
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
      org_token_balances_v: {
        Row: {
          balance: number | null
          held: number | null
          org_id: string | null
          usable: number | null
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
      profiles_safe: {
        Row: {
          created_at: string | null
          email: string | null
          full_name: string | null
          id: string | null
          org_id: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email?: never
          full_name?: string | null
          id?: string | null
          org_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: never
          full_name?: string | null
          id?: string | null
          org_id?: string | null
          status?: string | null
          updated_at?: string | null
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
      v_clip_on_reconciliation: {
        Row: {
          charged_audits: number | null
          clip_on_billed_at: string | null
          finding: string | null
          included_audits: number | null
          ledger_rows: number | null
          org_id: string | null
          priced_total_zar: number | null
          pricing_mode: string | null
          request_id: string | null
          status: string | null
        }
        Relationships: []
      }
      v_paystack_reconciliation: {
        Row: {
          expected_credits: number | null
          expected_currency: string | null
          expected_package_id: string | null
          expected_price_usd: number | null
          init_backfilled: boolean | null
          init_org_id: string | null
          initiated_at: string | null
          marked_failed: boolean | null
          payment_reference: string | null
          purch_backfilled: boolean | null
          settled_at: string | null
          settled_credits: number | null
          settled_currency: string | null
          settled_org_id: string | null
          settled_package_id: string | null
          settled_price_usd: number | null
          status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_org_id_fkey"
            columns: ["init_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_org_id_fkey"
            columns: ["settled_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      v_poi_burn_reconciliation: {
        Row: {
          action_type: string | null
          classification: string | null
          created_at: string | null
          endpoint: string | null
          id: string | null
          ledger_event_id: string | null
          match_id: string | null
          minted_at: string | null
          org_id: string | null
          outcome: string | null
          request_id: string | null
          tokens_burned: number | null
        }
        Relationships: [
          {
            foreignKeyName: "token_ledger_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_endpoints_safe: {
        Row: {
          created_at: string | null
          events: string[] | null
          id: string | null
          last_delivery_at: string | null
          org_id: string | null
          status: string | null
          updated_at: string | null
          url: string | null
        }
        Insert: {
          created_at?: string | null
          events?: string[] | null
          id?: string | null
          last_delivery_at?: string | null
          org_id?: string | null
          status?: string | null
          updated_at?: string | null
          url?: string | null
        }
        Update: {
          created_at?: string | null
          events?: string[] | null
          id?: string | null
          last_delivery_at?: string | null
          org_id?: string | null
          status?: string | null
          updated_at?: string | null
          url?: string | null
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
    }
    Functions: {
      _is_uuid: { Args: { p_text: string }; Returns: boolean }
      _provision_user: {
        Args: { p_email: string; p_full_name?: string; p_user_id: string }
        Returns: Json
      }
      acknowledge_acceptance_receipt: {
        Args: {
          p_ip_address?: string
          p_receipt_id: string
          p_user_agent?: string
        }
        Returns: Json
      }
      admin_archive_duplicate_match: {
        Args: {
          p_admin_user_id: string
          p_duplicate_of_match_id: string
          p_match_id: string
          p_reason: string
        }
        Returns: Json
      }
      admin_archive_legacy_match: {
        Args: { p_admin_user_id: string; p_match_id: string; p_notes: string }
        Returns: Json
      }
      admin_archive_trade_request_override: {
        Args: {
          p_admin_user_id: string
          p_reason: string
          p_trade_request_id: string
        }
        Returns: Json
      }
      admin_billing_hold_apply_with_governance: {
        Args: {
          p_aal?: string
          p_action_code?: string
          p_admin_user_id: string
          p_org_id: string
          p_policy_version?: string
          p_reason: string
          p_request_id: string
        }
        Returns: Json
      }
      admin_billing_hold_release_with_governance: {
        Args: {
          p_aal?: string
          p_action_code?: string
          p_admin_user_id: string
          p_org_id: string
          p_policy_version?: string
          p_reason: string
          p_request_id: string
        }
        Returns: Json
      }
      admin_compliance_hold_close_with_governance: {
        Args: {
          p_aal?: string
          p_action_code?: string
          p_admin_user_id: string
          p_hold_id: string
          p_policy_version?: string
          p_reason: string
          p_request_id: string
        }
        Returns: Json
      }
      admin_compliance_hold_release_with_governance: {
        Args: {
          p_aal?: string
          p_action_code?: string
          p_admin_user_id: string
          p_hold_id: string
          p_policy_version?: string
          p_reason: string
          p_request_id: string
        }
        Returns: Json
      }
      admin_correct_match_jurisdiction: {
        Args: {
          p_admin_user_id: string
          p_destination_country: string
          p_match_id: string
          p_origin_country: string
          p_reason: string
        }
        Returns: Json
      }
      admin_counterparty_corrections_with_governance: {
        Args: {
          p_aal?: string
          p_admin_user_id: string
          p_operation: string
          p_params: Json
          p_policy_version?: string
          p_reason: string
          p_request_id: string
        }
        Returns: Json
      }
      admin_credit_org_with_governance: {
        Args: {
          p_aal?: string
          p_action_code?: string
          p_actor_user_id: string
          p_amount: number
          p_credit_kind: string
          p_demo: boolean
          p_org_id: string
          p_policy_version?: string
          p_reason: string
          p_reference_id: string
          p_request_id: string
        }
        Returns: Json
      }
      admin_get_reconciliation_alarms: {
        Args: {
          p_alarm_type?: string
          p_limit?: number
          p_severity?: string
          p_since?: string
        }
        Returns: {
          alarm_id: string
          alarm_type: string
          counterparty_email: string
          detail: Json
          detected_at: string
          engagement_id: string
          match_id: string
          org_id: string
          severity: string
          summary: string
        }[]
      }
      admin_link_counterparty_to_org: {
        Args: {
          p_admin_user_id: string
          p_counterparty_id: string
          p_org_id: string
          p_reason: string
        }
        Returns: Json
      }
      admin_list_inconsistent_matches: {
        Args: never
        Returns: {
          buyer_committed_at: string
          buyer_name: string
          buyer_org_id: string
          commodity: string
          created_at: string
          id: string
          inconsistency_reasons: string[]
          metadata: Json
          org_id: string
          poi_state: string
          seller_committed_at: string
          seller_name: string
          seller_org_id: string
          settled_at: string
          state: string
          status: string
        }[]
      }
      admin_manual_override_with_governance: {
        Args: {
          p_aal?: string
          p_actor_ip?: string
          p_admin_user_id: string
          p_after_snapshot?: Json
          p_before_snapshot?: Json
          p_operation: string
          p_operation_result?: Json
          p_params: Json
          p_policy_version?: string
          p_reason: string
          p_request_id: string
          p_user_agent?: string
        }
        Returns: Json
      }
      admin_match_corrections_with_governance: {
        Args: {
          p_aal?: string
          p_admin_user_id: string
          p_operation: string
          p_params: Json
          p_policy_version?: string
          p_reason: string
          p_request_id: string
        }
        Returns: Json
      }
      admin_merge_counterparties: {
        Args: {
          p_admin_user_id: string
          p_duplicate_id: string
          p_primary_id: string
          p_reason: string
        }
        Returns: Json
      }
      admin_payment_dispute_record_with_governance: {
        Args: {
          p_aal?: string
          p_action_code?: string
          p_admin_user_id: string
          p_credits_issued: number
          p_org_id: string
          p_policy_version?: string
          p_provider: string
          p_provider_dispute_reference: string
          p_reason: string
          p_request_id: string
          p_token_purchase_id: string
        }
        Returns: Json
      }
      admin_payment_dispute_resolve_lost_with_governance: {
        Args: {
          p_aal?: string
          p_action_code?: string
          p_admin_user_id: string
          p_payment_dispute_id: string
          p_policy_version?: string
          p_reason: string
          p_request_id: string
        }
        Returns: Json
      }
      admin_payment_dispute_resolve_won_with_governance: {
        Args: {
          p_aal?: string
          p_action_code?: string
          p_admin_user_id: string
          p_payment_dispute_id: string
          p_policy_version?: string
          p_reason: string
          p_request_id: string
        }
        Returns: Json
      }
      admin_record_legacy_detections: {
        Args: { p_admin_user_id: string; p_match_ids?: string[] }
        Returns: Json
      }
      admin_refund_approve_with_governance: {
        Args: {
          p_aal?: string
          p_action_code?: string
          p_admin_user_id: string
          p_policy_version?: string
          p_reason: string
          p_refund_request_id: string
          p_request_id: string
        }
        Returns: Json
      }
      admin_refund_decline_with_governance: {
        Args: {
          p_aal?: string
          p_action_code?: string
          p_admin_user_id: string
          p_policy_version?: string
          p_reason: string
          p_refund_request_id: string
          p_request_id: string
        }
        Returns: Json
      }
      admin_release_trade_request_exception_hold: {
        Args: {
          p_admin_user_id: string
          p_reason: string
          p_trade_request_id: string
        }
        Returns: Json
      }
      admin_relink_match_counterparty: {
        Args: {
          p_admin_user_id: string
          p_match_id: string
          p_new_org_id: string
          p_reason: string
          p_side: string
        }
        Returns: Json
      }
      admin_repair_legacy_match: {
        Args: {
          p_admin_user_id: string
          p_match_id: string
          p_notes: string
          p_operation: string
        }
        Returns: Json
      }
      admin_residency_review_approve_with_governance: {
        Args: {
          p_aal?: string
          p_action_code?: string
          p_admin_user_id: string
          p_policy_version?: string
          p_reason: string
          p_request_id: string
          p_review_id: string
        }
        Returns: Json
      }
      admin_residency_review_decline_with_governance: {
        Args: {
          p_aal?: string
          p_action_code?: string
          p_admin_user_id: string
          p_policy_version?: string
          p_reason: string
          p_request_id: string
          p_review_id: string
        }
        Returns: Json
      }
      admin_trade_request_archive_override_with_governance: {
        Args: {
          p_aal?: string
          p_action_code?: string
          p_admin_user_id: string
          p_policy_version?: string
          p_reason: string
          p_request_id: string
          p_trade_request_id: string
        }
        Returns: Json
      }
      admin_trade_request_exception_hold_release_with_governance: {
        Args: {
          p_aal?: string
          p_action_code?: string
          p_admin_user_id: string
          p_policy_version?: string
          p_reason: string
          p_request_id: string
          p_trade_request_id: string
        }
        Returns: Json
      }
      ai_increment_match_run_count: {
        Args: { p_match_id: string; p_max_runs: number }
        Returns: number
      }
      ai_meter_check_and_increment: {
        Args: { p_call_type: string; p_daily_cap: number; p_org_id: string }
        Returns: number
      }
      ai_proposed_match_is_linked: {
        Args: { p_proposed_match_id: string }
        Returns: boolean
      }
      ai_provider_in_cooldown: {
        Args: { p_org_id: string; p_provider?: string }
        Returns: string
      }
      anonymise_old_email_send_log: {
        Args: { p_days?: number; p_dry_run?: boolean }
        Returns: Json
      }
      apply_billing_hold: {
        Args: { p_admin_user_id: string; p_org_id: string; p_reason: string }
        Returns: Json
      }
      approve_admin_export: {
        Args: {
          p_approval_method: string
          p_approver_user_id: string
          p_request_id: string
        }
        Returns: {
          approval: Json
          block_reason: string | null
          created_at: string
          date_range: Json | null
          expires_at: string | null
          governance_record_id: string | null
          id: string
          kind: string
          purpose: string | null
          reason: string | null
          redaction_mode: string | null
          requested_at: string
          requested_categories: string[]
          requester_user_id: string
          resolved_categories: string[]
          status: string
          subject_user_id: string | null
          target_org_id: string | null
          updated_at: string
          verification: Json
        }
        SetofOptions: {
          from: "*"
          to: "export_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      approve_admin_governance_export: {
        Args: {
          p_approval_note?: string
          p_approver_user_id: string
          p_request_id: string
        }
        Returns: Json
      }
      approve_refund: {
        Args: {
          p_admin_user_id: string
          p_reason: string
          p_refund_request_id: string
        }
        Returns: Json
      }
      approve_residency_review: {
        Args: { p_admin_user_id: string; p_reason: string; p_review_id: string }
        Returns: Json
      }
      archive_demo_workspace: {
        Args: {
          p_admin_user_id: string
          p_dataset_id: string
          p_reason: string
        }
        Returns: Json
      }
      archive_programme_participant: {
        Args: {
          p_actor_org_id: string
          p_actor_user_id: string
          p_override_linked?: boolean
          p_participant_id: string
          p_reason: string
        }
        Returns: Json
      }
      archive_trade_request: {
        Args: {
          p_actor_org_id: string
          p_actor_user_id: string
          p_reason?: string
          p_trade_request_id: string
        }
        Returns: Json
      }
      assign_match_named_contact: {
        Args: {
          p_assigned_by_role: string
          p_assigned_by_user_id: string
          p_contact_email: string
          p_contact_name: string
          p_match_id: string
          p_notes?: string
          p_side: string
        }
        Returns: Json
      }
      atomic_accept_bind: {
        Args: {
          p_caller_org_id: string
          p_counterparty_name: string
          p_counterparty_org_id: string
          p_counterparty_role: string
          p_match_id: string
        }
        Returns: Json
      }
      atomic_check_and_increment_rate_limit: {
        Args: {
          p_endpoint: string
          p_limit: number
          p_org_id: string
          p_window_end: string
        }
        Returns: number
      }
      atomic_collapse_record: {
        Args: {
          p_collapse: Json
          p_governance_execution: Json
          p_governance_finality: Json
        }
        Returns: Json
      }
      atomic_decline_late_acceptance: {
        Args: {
          p_actor_email: string
          p_actor_name: string
          p_actor_user_id: string
          p_audit_org_id: string
          p_parent_engagement_id: string
        }
        Returns: Json
      }
      atomic_dispute_open: {
        Args: { p_governance?: Json; p_input: Json }
        Returns: Json
      }
      atomic_dispute_transition: {
        Args: { p_governance?: Json; p_input: Json }
        Returns: Json
      }
      atomic_engagement_transition: {
        Args: {
          p_actor_email: string
          p_actor_name: string
          p_actor_type: string
          p_actor_user_id: string
          p_audit_action?: string
          p_audit_org_id?: string
          p_contact_detail?: string
          p_contact_method?: string
          p_engagement_id: string
          p_entry_type: string
          p_new_status: string
          p_notes?: string
        }
        Returns: Json
      }
      atomic_expire_late_acceptance_reconfirmation_window: {
        Args: { p_engagement_id: string }
        Returns: Json
      }
      atomic_export_transition: {
        Args: {
          p_expected_from: string
          p_new_status: string
          p_patch: Json
          p_request_id: string
        }
        Returns: {
          approval: Json
          block_reason: string | null
          created_at: string
          date_range: Json | null
          expires_at: string | null
          governance_record_id: string | null
          id: string
          kind: string
          purpose: string | null
          reason: string | null
          redaction_mode: string | null
          requested_at: string
          requested_categories: string[]
          requester_user_id: string
          resolved_categories: string[]
          status: string
          subject_user_id: string | null
          target_org_id: string | null
          updated_at: string
          verification: Json
        }
        SetofOptions: {
          from: "*"
          to: "export_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      atomic_generate_poi_v2:
        | {
            Args: {
              p_acks?: Json
              p_actor_user_id?: string
              p_match_id: string
              p_org_id: string
              p_settled_at: string
              p_terms_hash?: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_acks?: Json
              p_actor_user_id?: string
              p_governance?: Json
              p_match_id: string
              p_org_id: string
              p_settled_at: string
              p_terms_hash?: string
            }
            Returns: Json
          }
      atomic_legal_hold_apply: {
        Args: { p_governance?: Json; p_input: Json }
        Returns: Json
      }
      atomic_legal_hold_release: {
        Args: { p_governance?: Json; p_input: Json }
        Returns: Json
      }
      atomic_org_retention_clear: { Args: { p_input: Json }; Returns: Json }
      atomic_org_retention_set: { Args: { p_input: Json }; Returns: Json }
      atomic_poi_match_transition: {
        Args: {
          p_actor_user_id: string
          p_from_state: string
          p_governance?: Json
          p_match_id: string
          p_metadata?: Json
          p_org_id: string
          p_reason?: string
          p_to_state: string
        }
        Returns: Json
      }
      atomic_pois_create: {
        Args: {
          p_actor_role: string
          p_actor_user_id: string
          p_buyer_entity_id: string
          p_completion_probability: number
          p_governance?: Json
          p_idempotency_key: string
          p_idempotency_request_hash: string
          p_idempotency_response: Json
          p_idempotency_status: number
          p_industry_code: string
          p_jurisdiction_code: string
          p_legacy_event_hash: string
          p_legacy_event_payload: Json
          p_legacy_event_type: string
          p_org_id: string
          p_poi_type: string
          p_seller_entity_id: string
          p_terms: Json
        }
        Returns: Json
      }
      atomic_pois_transition: {
        Args: {
          p_actor_api_key_id?: string
          p_actor_role?: string
          p_actor_user_id?: string
          p_governance?: Json
          p_legacy_event_hash?: string
          p_org_id: string
          p_poi_id: string
          p_reason?: string
          p_to_state: string
        }
        Returns: Json
      }
      atomic_reconfirm_late_acceptance: {
        Args: {
          p_actor_email: string
          p_actor_name: string
          p_actor_user_id: string
          p_audit_org_id: string
          p_parent_engagement_id: string
        }
        Returns: Json
      }
      atomic_record_late_acceptance: {
        Args: {
          p_actor_email: string
          p_actor_name: string
          p_actor_user_id: string
          p_audit_org_id: string
          p_engagement_id: string
        }
        Returns: Json
      }
      atomic_seal_deal: {
        Args: {
          p_actor_api_key_id?: string
          p_actor_user_id: string
          p_collapse_payload?: Json
          p_event_data: Json
          p_event_type: string
          p_expected_state: string
          p_match_id: string
          p_org_id: string
        }
        Returns: Json
      }
      atomic_token_burn:
        | {
            Args: {
              p_amount: number
              p_org_id: string
              p_reason?: string
              p_reference_id?: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_amount: number
              p_governance?: Json
              p_org_id: string
              p_reason?: string
              p_reference_id?: string
            }
            Returns: Json
          }
      atomic_token_credit:
        | {
            Args: {
              p_amount: number
              p_org_id: string
              p_reason?: string
              p_reference_id?: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_amount: number
              p_extra_metadata?: Json
              p_org_id: string
              p_reason?: string
              p_reference_id?: string
            }
            Returns: Json
          }
      atomic_validate_governance_doc: {
        Args: {
          p_actor_user_id?: string
          p_burn_amount: number
          p_doc_type?: string
          p_governance_doc_id: string
          p_org_id: string
        }
        Returns: Json
      }
      atomic_wad_deny: {
        Args: {
          p_denial_reasons: Json
          p_governance?: Json
          p_org_id: string
          p_poi_id: string
        }
        Returns: Json
      }
      atomic_wad_issue: {
        Args: { p_governance?: Json; p_org_id: string; p_poi_id: string }
        Returns: Json
      }
      bill_clip_on_request: { Args: { p_request_id: string }; Returns: Json }
      bill_clip_on_subscriptions_monthly: { Args: never; Returns: Json }
      bump_provider_retry: {
        Args: {
          _cooldown_seconds?: number
          _entity_id: string
          _gate: string
          _org_id: string
          _provider: string
          _scope_key: string
          _threshold?: number
        }
        Returns: {
          cooldown_until: string | null
          created_at: string
          entity_id: string | null
          failure_count: number
          gate: string
          id: string
          last_failure_at: string
          org_id: string | null
          provider: string
          scope_key: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "provider_retry_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      can_delete_match_document_object: {
        Args: { _object_name: string; _owner_id?: string; _user_id: string }
        Returns: boolean
      }
      change_org_member_role: {
        Args: {
          p_new_role: string
          p_reason?: string
          p_target_user_id: string
        }
        Returns: Json
      }
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
      check_document_version_integrity: {
        Args: never
        Returns: {
          current_version_count: number
          doc_type: string
          issue: string
          match_id: string
        }[]
      }
      check_engagement_email_delivery: {
        Args: never
        Returns: {
          counterparty_email: string
          email_status: string
          engagement_id: string
          engagement_status: string
          issue: string
          match_id: string
        }[]
      }
      check_engagement_log_integrity: {
        Args: never
        Returns: {
          details: string
          issue_type: string
          out_engagement_id: string
        }[]
      }
      check_match_state_invariants: {
        Args: never
        Returns: {
          current_state: string
          match_id: string
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
      cleanup_expired_unsubscribe_tokens: { Args: never; Returns: number }
      cleanup_old_auth_rate_limits: { Args: never; Returns: number }
      closeout_drift_summary: { Args: never; Returns: Json }
      compute_all_behavioral_kyc_scores: {
        Args: { p_days?: number }
        Returns: {
          behavioral_band: string
          behavioral_score: number
          kyc_completeness: number
          kyc_status: string
          maybe_later: number
          org_id: string
          org_name: string
          skips: number
          total_signals: number
          views: number
        }[]
      }
      compute_behavioral_score: {
        Args: { p_days?: number; p_org_id: string }
        Returns: Json
      }
      compute_match_terms_hash: {
        Args: { p_match_id: string }
        Returns: string
      }
      create_demo_workspace: {
        Args: { p_admin_user_id: string; p_org_name: string; p_reason: string }
        Returns: Json
      }
      cron_invoke: {
        Args: { p_body?: Json; p_job_name: string; p_url: string }
        Returns: number
      }
      cron_reconcile_heartbeats: { Args: never; Returns: undefined }
      data_004_cron_drift_check: { Args: never; Returns: Json }
      decline_refund: {
        Args: {
          p_admin_user_id: string
          p_reason: string
          p_refund_request_id: string
        }
        Returns: Json
      }
      decline_residency_review: {
        Args: { p_admin_user_id: string; p_reason: string; p_review_id: string }
        Returns: Json
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      detect_match_quality_warnings: {
        Args: { p_match_id: string }
        Returns: Json
      }
      discover_cold_storage_archive_candidates: {
        Args: { p_limit?: number }
        Returns: {
          already_exported: boolean
          flag_id: string
          org_id: string
          record_created_at: string
          record_id: string
          retention_action: string
          retention_expires_at: string
          retention_status: string
          table_name: string
        }[]
      }
      discover_email_send_log_candidate_orgs: {
        Args: { p_limit?: number }
        Returns: {
          oldest_created_at: string
          org_id: string
          row_count: number
        }[]
      }
      document_access_visible: {
        Args: { _document_id: string; _user: string }
        Returns: boolean
      }
      dry_run_legacy_reconciliation: { Args: never; Returns: Json }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      ensure_poi_engagement_for_minted_match: {
        Args: { p_match_id: string; p_org_id: string }
        Returns: Json
      }
      ensure_sole_member_is_org_admin: {
        Args: { _org_id: string }
        Returns: undefined
      }
      ensure_user_profile: {
        Args: { p_email: string; p_user_id: string }
        Returns: Json
      }
      facilitation_case_visible: {
        Args: { _case: string; _user: string }
        Returns: boolean
      }
      generate_event_hash: {
        Args: { event_data: Json; event_type: string; previous_hash: string }
        Returns: string
      }
      get_billing_availability: { Args: never; Returns: Json }
      get_cold_storage_archive_cron_jobs: {
        Args: never
        Returns: {
          active: boolean
          is_dry_run: boolean
          jobid: number
          jobname: string
          schedule: string
        }[]
      }
      get_effective_retention_days: {
        Args: {
          _org_id: string
          _record_class: Database["public"]["Enums"]["org_retention_record_class"]
        }
        Returns: number
      }
      get_email_retention_health: { Args: never; Returns: Json }
      get_match_approved_ai_summary: {
        Args: { _match_id: string }
        Returns: {
          approved_at: string
          counterparty_role: string
          jurisdiction: string
          match_id: string
          proposed_match_id: string
          sector_or_product_fit: string
          short_summary: string
          status_label: string
          suggested_counterparty_name: string
        }[]
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
      get_match_named_contact_status: {
        Args: { p_match_id: string }
        Returns: {
          assigned_at: string
          assigned_by_role: string
          contact_email: string
          contact_name: string
          id: string
          match_id: string
          org_id: string
          side: string
          status: string
        }[]
      }
      get_org_gate_position: {
        Args: { _org_id: string }
        Returns: Database["public"]["Enums"]["gate_position"]
      }
      get_purge_email_send_log_cron_jobs: {
        Args: never
        Returns: {
          active: boolean
          is_dry_run: boolean
          jobid: number
          jobname: string
          schedule: string
        }[]
      }
      get_retention_floor_days: {
        Args: {
          _record_class: Database["public"]["Enums"]["org_retention_record_class"]
        }
        Returns: number
      }
      get_test_mode_bypass_state: { Args: never; Returns: Json }
      get_test_mode_lockout_state: { Args: never; Returns: Json }
      get_user_email: { Args: { target_user_id: string }; Returns: string }
      gov_domain_for: { Args: { p_event_type: string }; Returns: string }
      gov_emit_event: { Args: { p_input: Json }; Returns: string }
      gov_redact_jsonb: {
        Args: { p_depth?: number; p_input: Json }
        Returns: Json
      }
      has_dd_role: {
        Args: { _org_id: string; _role: string; _user_id: string }
        Returns: boolean
      }
      has_open_match_challenge: {
        Args: { p_match_id: string }
        Returns: boolean
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
      is_counterparty_unknown_for_match: {
        Args: { p_match_id: string }
        Returns: boolean
      }
      is_match_participant: {
        Args: { _match_id: string; _user_id: string }
        Returns: boolean
      }
      is_match_participant_member: {
        Args: { _match_id: string; _user_id: string }
        Returns: boolean
      }
      is_match_party_org_admin: {
        Args: { _match_id: string; _user_id: string }
        Returns: boolean
      }
      is_org_admin: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      is_production_environment: { Args: never; Returns: boolean }
      is_same_org: {
        Args: { _target_id: string; _viewer_id: string }
        Returns: boolean
      }
      is_test_mode_bypass_enabled: { Args: { _gate: string }; Returns: boolean }
      mark_export_file_destroyed: {
        Args: { p_file_id: string; p_reason: string }
        Returns: {
          byte_size: number
          created_at: string
          destroy_reason: string | null
          destroyed_at: string | null
          downloads: Json
          expires_at: string
          export_request_id: string
          format: string
          generated_at: string
          id: string
          row_counts: Json
          sha256: string
          storage_bucket: string
          storage_path: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "export_files"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      match_document_visible: {
        Args: { _document_id: string; _user: string }
        Returns: boolean
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      platform_admin_break_glass_progress:
        | {
            Args: {
              p_actor_user_id: string
              p_match_id: string
              p_reason: string
            }
            Returns: {
              break_glass_override_used: boolean
              closed_at: string | null
              closed_by_user_id: string | null
              created_at: string
              id: string
              match_id: string
              org_id: string
              outcome_code: string | null
              outcome_summary: string | null
              raised_by_org_id: string | null
              raised_by_role: string
              raised_by_user_id: string
              rating_impact_emitted: boolean
              status: string
              subject_code: string
              summary: string
              under_review_at: string | null
              updated_at: string
            }
            SetofOptions: {
              from: "*"
              to: "match_challenges"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              p_actor_user_id: string
              p_internal_approval_reference?: string
              p_match_id: string
              p_reason: string
              p_reason_category?: string
              p_regulator_reference?: string
            }
            Returns: {
              break_glass_override_used: boolean
              closed_at: string | null
              closed_by_user_id: string | null
              created_at: string
              id: string
              match_id: string
              org_id: string
              outcome_code: string | null
              outcome_summary: string | null
              raised_by_org_id: string | null
              raised_by_role: string
              raised_by_user_id: string
              rating_impact_emitted: boolean
              status: string
              subject_code: string
              summary: string
              under_review_at: string | null
              updated_at: string
            }
            SetofOptions: {
              from: "*"
              to: "match_challenges"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      prune_webhook_replay_guard: { Args: never; Returns: number }
      purge_old_email_send_log: { Args: never; Returns: number }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      reconcile_acceptance_notifications: { Args: never; Returns: Json }
      reconcile_paystack_purchases: {
        Args: { p_window?: string }
        Returns: {
          n: number
          status: string
        }[]
      }
      reconcile_poi_burns: { Args: { p_since?: string }; Returns: Json }
      reconcile_token_balances: {
        Args: never
        Returns: {
          computed_balance: number
          discrepancy: number
          org_id: string
          recorded_balance: number
          status: string
          total_burned: number
          total_credited: number
        }[]
      }
      record_clip_on_billing_failure: {
        Args: { p_reason: Json; p_request_id: string }
        Returns: undefined
      }
      record_export_download: {
        Args: { p_actor_meta: Json; p_file_id: string }
        Returns: {
          byte_size: number
          created_at: string
          destroy_reason: string | null
          destroyed_at: string | null
          downloads: Json
          expires_at: string
          export_request_id: string
          format: string
          generated_at: string
          id: string
          row_counts: Json
          sha256: string
          storage_bucket: string
          storage_path: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "export_files"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_export_file: {
        Args: {
          p_bucket: string
          p_byte_size: number
          p_expires_at: string
          p_format: string
          p_path: string
          p_request_id: string
          p_row_counts: Json
          p_sha256: string
        }
        Returns: string
      }
      record_payment_dispute: {
        Args: {
          p_actor_user_id?: string
          p_credits_issued: number
          p_metadata?: Json
          p_org_id: string
          p_provider: string
          p_provider_dispute_reference: string
          p_source: string
          p_token_purchase_id: string
        }
        Returns: Json
      }
      record_role_confirmation: {
        Args: {
          p_confirmed_side: string
          p_draft_id?: string
          p_inferred_side: string
          p_match_id?: string
          p_original_selected_side: string
          p_source_component?: string
        }
        Returns: string
      }
      refund_tokens_on_conflict: {
        Args: {
          p_actor_user_id?: string
          p_amount: number
          p_match_id: string
          p_org_id: string
          p_reason: string
          p_request_id: string
        }
        Returns: Json
      }
      release_billing_hold: {
        Args: { p_admin_user_id: string; p_org_id: string; p_reason: string }
        Returns: Json
      }
      release_lifecycle_lock: { Args: never; Returns: undefined }
      request_admin_export: {
        Args: {
          p_date_range: Json
          p_purpose: string
          p_reason: string
          p_requested_categories: string[]
          p_requester_user_id: string
          p_subject_user_id: string
          p_target_org_id: string
        }
        Returns: string
      }
      request_admin_governance_export: {
        Args: {
          p_date_range?: Json
          p_governance_record_id: string
          p_legal_hold_context?: Json
          p_purpose: string
          p_reason: string
          p_redaction_mode?: string
          p_requested_categories: string[]
          p_requester_user_id: string
          p_target_org_id?: string
        }
        Returns: string
      }
      request_refund: {
        Args: {
          p_org_id: string
          p_reason_code: string
          p_reason_detail: string
          p_token_purchase_id: string
          p_user_id: string
        }
        Returns: Json
      }
      request_residency_review: {
        Args: {
          p_legal_basis?: string
          p_metadata?: Json
          p_org_id: string
          p_requested_country?: string
          p_requested_region?: string
          p_requirement_source: string
        }
        Returns: Json
      }
      request_user_export: {
        Args: { p_requested_categories: string[]; p_subject_user_id: string }
        Returns: string
      }
      reset_auth_rate_limit: {
        Args: { p_identifier: string; p_identifier_type: string }
        Returns: undefined
      }
      reset_demo_workspace: {
        Args: {
          p_admin_user_id: string
          p_dataset_id: string
          p_reason: string
        }
        Returns: Json
      }
      resolve_admin_risk_item: {
        Args: {
          p_actor_ip?: string
          p_admin_user_id: string
          p_new_status: string
          p_reason: string
          p_request_id?: string
          p_risk_item_id: string
          p_user_agent?: string
        }
        Returns: Json
      }
      resolve_notifications_for: {
        Args: { p_entity_id: string; p_entity_type: string }
        Returns: number
      }
      resolve_payment_dispute_lost: {
        Args: {
          p_admin_user_id: string
          p_payment_dispute_id: string
          p_reason: string
        }
        Returns: Json
      }
      resolve_payment_dispute_won: {
        Args: {
          p_admin_user_id: string
          p_payment_dispute_id: string
          p_reason: string
        }
        Returns: Json
      }
      run_data_integrity_checks: { Args: never; Returns: Json }
      safe_transition_match_state: {
        Args: {
          p_expected_state: string
          p_match_id: string
          p_new_state: string
          p_org_id: string
          p_update_fields?: Json
        }
        Returns: Json
      }
      safe_update_deal_terms: {
        Args: {
          p_deal_term_id: string
          p_expected_version: number
          p_org_id: string
          p_updates: Json
        }
        Returns: Json
      }
      scrub_user_pii: { Args: { p_user_id: string }; Returns: Json }
      set_org_data_residency: { Args: { _region: string }; Returns: Json }
      tenant_boundary_inventory: {
        Args: never
        Returns: {
          all_policies: number
          delete_policies: number
          has_permissive_true: boolean
          insert_policies: number
          policy_count: number
          references_auth_uid: boolean
          references_has_role: boolean
          references_org_id: boolean
          rls_enabled: boolean
          select_policies: number
          table_name: string
          update_policies: number
        }[]
      }
      touch_match_view: { Args: { _match_id: string }; Returns: string }
      transfer_org_admin: {
        Args: {
          p_demote_self?: boolean
          p_reason: string
          p_to_user_id: string
        }
        Returns: Json
      }
      try_lifecycle_lock: { Args: never; Returns: boolean }
      verify_acceptance_receipt: {
        Args: { p_receipt_id: string }
        Returns: Json
      }
      verify_event_chain_integrity: {
        Args: never
        Returns: {
          details: string
          issue_type: string
          match_id: string
        }[]
      }
      webhook_record_failure: {
        Args: { p_endpoint_id: string; p_threshold?: number }
        Returns: {
          new_consecutive_failures: number
          tripped: boolean
        }[]
      }
      webhook_record_success: {
        Args: { p_endpoint_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "seller"
        | "broker"
        | "buyer"
        | "auditor"
        | "platform_admin"
        | "org_admin"
        | "org_member"
        | "api_admin"
        | "billing_admin"
        | "compliance_analyst"
        | "legal_reviewer"
        | "director"
      counterparty_type: "known" | "unknown"
      engagement_status:
        | "pending"
        | "notification_sent"
        | "contacted"
        | "accepted"
        | "declined"
        | "expired"
        | "late_acceptance_pending_initiator_reconfirmation"
        | "cancelled_email_change"
        | "disputed_being_named"
        | "cancelled_by_initiator"
      gate_position: "entry" | "poi_mint" | "wad_only"
      org_retention_record_class:
        | "matches"
        | "trade_requests"
        | "pois"
        | "wads"
        | "evidence"
        | "audit_logs"
        | "email_send_log"
        | "governance_records"
      revenue_notification_status: "sent" | "failed" | "skipped"
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
      app_role: [
        "admin",
        "seller",
        "broker",
        "buyer",
        "auditor",
        "platform_admin",
        "org_admin",
        "org_member",
        "api_admin",
        "billing_admin",
        "compliance_analyst",
        "legal_reviewer",
        "director",
      ],
      counterparty_type: ["known", "unknown"],
      engagement_status: [
        "pending",
        "notification_sent",
        "contacted",
        "accepted",
        "declined",
        "expired",
        "late_acceptance_pending_initiator_reconfirmation",
        "cancelled_email_change",
        "disputed_being_named",
        "cancelled_by_initiator",
      ],
      gate_position: ["entry", "poi_mint", "wad_only"],
      org_retention_record_class: [
        "matches",
        "trade_requests",
        "pois",
        "wads",
        "evidence",
        "audit_logs",
        "email_send_log",
        "governance_records",
      ],
      revenue_notification_status: ["sent", "failed", "skipped"],
      signal_type: ["buyer", "seller"],
    },
  },
} as const
