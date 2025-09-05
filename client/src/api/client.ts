import axios from 'axios';

export interface QueryRequest {
  query: string;
  clientId: string;
  workflowMode: 'audit' | 'lending';
}

export interface QueryResponse {
  response: string;
  success: boolean;
  error?: string;
}

const apiClient = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const queryAgent = async (request: QueryRequest): Promise<QueryResponse> => {
  try {
    const response = await apiClient.post<QueryResponse>('/query', request);
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      return {
        response: '',
        success: false,
        error: error.response?.data?.error || error.message,
      };
    }
    return {
      response: '',
      success: false,
      error: 'An unexpected error occurred',
    };
  }
};