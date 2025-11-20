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
      api_keys: {
        Row: {
          created_at: string
          created_by: string | null
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
            foreignKeyName: "audit_logs_org_id_fkey"
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
      matches: {
        Row: {
          buyer_id: string
          buyer_name: string
          commodity: string
          created_at: string
          created_by: string | null
          hash: string
          id: string
          metadata: Json | null
          org_id: string
          price_amount: number
          price_currency: string
          quantity_amount: number
          quantity_unit: string
          seller_id: string
          seller_name: string
          settled_at: string | null
          status: string
          terms: string | null
        }
        Insert: {
          buyer_id: string
          buyer_name: string
          commodity: string
          created_at?: string
          created_by?: string | null
          hash: string
          id?: string
          metadata?: Json | null
          org_id: string
          price_amount: number
          price_currency: string
          quantity_amount: number
          quantity_unit: string
          seller_id: string
          seller_name: string
          settled_at?: string | null
          status?: string
          terms?: string | null
        }
        Update: {
          buyer_id?: string
          buyer_name?: string
          commodity?: string
          created_at?: string
          created_by?: string | null
          hash?: string
          id?: string
          metadata?: Json | null
          org_id?: string
          price_amount?: number
          price_currency?: string
          quantity_amount?: number
          quantity_unit?: string
          seller_id?: string
          seller_name?: string
          settled_at?: string | null
          status?: string
          terms?: string | null
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
          sahpra_licence_no: string | null
          sahpra_verification_data: Json | null
          sahpra_verified: boolean | null
          sahpra_verified_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sahpra_licence_no?: string | null
          sahpra_verification_data?: Json | null
          sahpra_verified?: boolean | null
          sahpra_verified_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sahpra_licence_no?: string | null
          sahpra_verification_data?: Json | null
          sahpra_verified?: boolean | null
          sahpra_verified_at?: string | null
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
            foreignKeyName: "rate_limits_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sahpra_licenses: {
        Row: {
          company_name: string
          company_name_norm: string | null
          created_at: string | null
          date_issued: string | null
          expiry_date: string
          id: string
          licence_no: string
          licence_type: string | null
          province: string | null
          responsible_pharmacist: string | null
          updated_at: string | null
        }
        Insert: {
          company_name: string
          company_name_norm?: string | null
          created_at?: string | null
          date_issued?: string | null
          expiry_date: string
          id?: string
          licence_no: string
          licence_type?: string | null
          province?: string | null
          responsible_pharmacist?: string | null
          updated_at?: string | null
        }
        Update: {
          company_name?: string
          company_name_norm?: string | null
          created_at?: string | null
          date_issued?: string | null
          expiry_date?: string
          id?: string
          licence_no?: string
          licence_type?: string | null
          province?: string | null
          responsible_pharmacist?: string | null
          updated_at?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_expired_idempotency_keys: { Args: never; Returns: number }
      cleanup_expired_rate_limits: { Args: never; Returns: number }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { user_id: string }; Returns: boolean }
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
