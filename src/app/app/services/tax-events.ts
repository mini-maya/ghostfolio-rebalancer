import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface TaxEvent {
  accountId: string;
  id: string;
  quantity: number;
  symbolId: string;
  taxYear: number;
  vorabpauschalePerShare: number;
  vorabpauschalePerShareAfterTeilfreistellung: number;
}

interface TaxEventsResponse {
  taxEvents: TaxEvent[];
}

interface TaxEventResponse {
  taxEvent: TaxEvent;
}

@Injectable({
  providedIn: 'root'
})
export class TaxEventsService {
  private readonly http = inject(HttpClient);

  public async loadTaxEvents(): Promise<TaxEvent[]> {
    const response = await firstValueFrom(
      this.http.get<TaxEventsResponse>('/api/tax-events')
    );

    return response.taxEvents ?? [];
  }

  public async createTaxEvent(taxEvent: Omit<TaxEvent, 'id'>): Promise<TaxEvent> {
    const response = await firstValueFrom(
      this.http.post<TaxEventResponse>('/api/tax-events', { taxEvent })
    );

    return response.taxEvent;
  }

  public async updateTaxEvent(
    taxEventId: string,
    taxEvent: Omit<TaxEvent, 'id'>
  ): Promise<TaxEvent> {
    const response = await firstValueFrom(
      this.http.put<TaxEventResponse>(`/api/tax-events/${encodeURIComponent(taxEventId)}`, {
        taxEvent
      })
    );

    return response.taxEvent;
  }

  public async deleteTaxEvent(taxEventId: string): Promise<void> {
    await firstValueFrom(
      this.http.delete(`/api/tax-events/${encodeURIComponent(taxEventId)}`)
    );
  }
}
