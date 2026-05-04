"""
Trade.Izenzo API - Python Client Example

This is a lightweight SDK wrapper for the Trade.Izenzo Compliance Matching API.
No installation required - just copy this code into your project.

Usage:
    client = TradeIzenzoClient('your-api-key-here')
    signal = client.create_signal(product='Paracetamol', quantity=1000, unit='kg')
"""

import requests
import json
from typing import Dict, Any, Optional, List
from datetime import datetime


class TradeIzenzoClient:
    """Client for Trade.Izenzo Compliance Matching API"""
    
    def __init__(self, api_key: str, base_url: str = None, timeout: int = 30):
        self.api_key = api_key
        self.base_url = base_url or 'https://api.trade.izenzo.co.za/functions/v1'
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({
            'X-API-Key': api_key,
            'Content-Type': 'application/json',
        })
    
    def _request(self, method: str, endpoint: str, **kwargs) -> Dict[str, Any]:
        """Make HTTP request to API"""
        url = f"{self.base_url}{endpoint}"
        
        try:
            response = self.session.request(
                method=method,
                url=url,
                timeout=self.timeout,
                **kwargs
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.HTTPError as e:
            error_data = e.response.json() if e.response.content else {}
            raise Exception(error_data.get('error', {}).get('message', str(e)))
        except requests.exceptions.Timeout:
            raise Exception('Request timeout')
        except Exception as e:
            raise Exception(f'API Error: {str(e)}')
    
    # Signal Management
    def create_signal(
        self,
        product: str,
        quantity: float,
        unit: str,
        location: Optional[str] = None,
        delivery_window: Optional[Dict[str, str]] = None,
        budget: Optional[float] = None,
        currency: Optional[str] = 'ZAR',
        notes: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a new signal"""
        data = {
            'product': product,
            'quantity': quantity,
            'unit': unit,
        }
        
        if location:
            data['location'] = location
        if delivery_window:
            data['deliveryWindow'] = delivery_window
        if budget:
            data['budget'] = budget
        if currency:
            data['currency'] = currency
        if notes:
            data['notes'] = notes
        
        return self._request('POST', '/signals', json=data)
    
    def get_signal(self, signal_id: str) -> Dict[str, Any]:
        """Get a signal by ID"""
        return self._request('GET', f'/signals/{signal_id}')
    
    def list_signals(self, **params) -> Dict[str, Any]:
        """List signals with optional filters"""
        return self._request('GET', '/signals', params=params)
    
    def select_option(self, signal_id: str, option_id: str) -> Dict[str, Any]:
        """Select an option for a signal"""
        return self._request(
            'POST',
            f'/signals/{signal_id}/select',
            json={'optionId': option_id}
        )
    
    # Match Management
    def create_match(
        self,
        buyer_id: str,
        buyer_name: str,
        seller_id: str,
        seller_name: str,
        commodity: str,
        quantity_amount: float,
        quantity_unit: str,
        price_amount: float,
        price_currency: str,
        terms: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Create a new match"""
        data = {
            'buyerId': buyer_id,
            'buyerName': buyer_name,
            'sellerId': seller_id,
            'sellerName': seller_name,
            'commodity': commodity,
            'quantityAmount': quantity_amount,
            'quantityUnit': quantity_unit,
            'priceAmount': price_amount,
            'priceCurrency': price_currency,
        }
        
        if terms:
            data['terms'] = terms
        if metadata:
            data['metadata'] = metadata
        
        return self._request('POST', '/match', json=data)
    
    def get_match(self, match_id: str) -> Dict[str, Any]:
        """Get a match by ID"""
        return self._request('GET', f'/match/{match_id}')
    
    def settle_match(self, match_id: str) -> Dict[str, Any]:
        """Settle a match"""
        return self._request('POST', f'/match/{match_id}/settle')
    
    def verify_match_hash(self, match_id: str, expected_hash: str) -> bool:
        """Verify a match hash hasn't been tampered with"""
        match = self.get_match(match_id)
        return match.get('hash') == expected_hash
    
    # Audit Logs
    def get_audit_logs(self, **params) -> List[Dict[str, Any]]:
        """Get audit logs with optional filters"""
        response = self._request('GET', '/audit-logs', params=params)
        return response.get('logs', [])
    
    # Webhooks
    def create_webhook(
        self,
        url: str,
        events: List[str],
    ) -> Dict[str, Any]:
        """Create a webhook endpoint"""
        return self._request(
            'POST',
            '/webhooks',
            json={'url': url, 'events': events}
        )
    
    def list_webhooks(self) -> List[Dict[str, Any]]:
        """List webhook endpoints"""
        response = self._request('GET', '/webhooks')
        return response.get('webhooks', [])
    
    def delete_webhook(self, webhook_id: str) -> Dict[str, Any]:
        """Delete a webhook endpoint"""
        return self._request('DELETE', f'/webhooks/{webhook_id}')
    
    # Verification
    def verify_sahpra(self, licence_number: str) -> Dict[str, Any]:
        """Verify SAHPRA licence"""
        return self._request(
            'POST',
            '/sahpra-verification',
            json={'licenceNumber': licence_number}
        )


# Example usage
def example():
    """Example usage of the Trade.Izenzo API client"""
    client = TradeIzenzoClient('tiz_sandbox_your_key_here')
    
    try:
        # Create a signal
        signal = client.create_signal(
            product='Paracetamol 500mg tablets',
            quantity=10000,
            unit='units',
            location='Johannesburg',
            delivery_window={
                'start': '2025-01-01',
                'end': '2025-01-31',
            },
            budget=5000,
            currency='ZAR',
        )
        
        print(f"Signal created: {signal['id']}")
        
        # Create a match
        match = client.create_match(
            buyer_id='buyer-123',
            buyer_name='Pharmacy Chain SA',
            seller_id='seller-456',
            seller_name='MedSupply Ltd',
            commodity='Paracetamol 500mg',
            quantity_amount=10000,
            quantity_unit='units',
            price_amount=4500,
            price_currency='ZAR',
            terms='Net 30 days, FOB Johannesburg',
        )
        
        print(f"Match created: {match['id']}")
        print(f"Match hash: {match['hash']}")
        
        # Settle the match
        settled = client.settle_match(match['id'])
        print(f"Match settled at: {settled['settled_at']}")
        
        # Verify hash hasn't changed
        is_valid = client.verify_match_hash(match['id'], match['hash'])
        print(f"Hash valid: {is_valid}")
        
        # Get audit logs
        logs = client.get_audit_logs(
            entity_type='match',
            entity_id=match['id']
        )
        print(f"Audit logs: {len(logs)}")
        
    except Exception as e:
        print(f"Error: {e}")


if __name__ == '__main__':
    example()
