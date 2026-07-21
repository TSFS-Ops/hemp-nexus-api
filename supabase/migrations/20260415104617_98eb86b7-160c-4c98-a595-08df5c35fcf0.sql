INSERT INTO api_request_logs (org_id, endpoint, method, status_code, response_time_ms)
SELECT '1be6cffa-d1d2-425e-b190-5c42ef14a8f0', '/v1/search', 'GET', 200, 142
WHERE EXISTS (SELECT 1 FROM organizations WHERE id = '1be6cffa-d1d2-425e-b190-5c42ef14a8f0');
