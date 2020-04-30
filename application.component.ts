import { HttpParams } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ComponentFactoryResolver,
  Input,
  ViewChild,
} from '@angular/core';
import { Metric, Application, ApplicationList } from '@api/symui';
import { Observable } from 'rxjs/Observable';
import { Router } from '@angular/router';

import { ResourceListWithStatuses } from '../../../resources/list';
import { EndpointManager, Resource } from '../../../services/resource/endpoint';
import { NamespacedResourceService, ListGroupIdentifier, ListIdentifier } from '../../../services/resource/resource';
import { NotificationsService } from '@service/global/notifications.service';
import { MenuComponent } from '../../list/column/menu/menu.component';

@Component({
  selector: 'sym-application-list',
  templateUrl: './application.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApplicationListComponent extends ResourceListWithStatuses<ApplicationList, Application> {
  @Input() endpoint = EndpointManager.resource(Resource.application, true).list();
  @Input() showMetrics = false;
  @Input() initialized: boolean;
  @Input() deployment: string;

  cumulativeMetrics: Metric[];
  pageSize = 5;
  pageSizeOptions: number[] = [5, 10, 25, 100];
  namespace: string;
  nsList: any;

  constructor(
    private router: Router,
    private readonly application_: NamespacedResourceService<ApplicationList>,
    resolver: ComponentFactoryResolver,
    notifications: NotificationsService,
    cdr: ChangeDetectorRef,
  ) {
    super('application', notifications, cdr, resolver);
    this.id = ListIdentifier.application;
    this.groupId = ListGroupIdentifier.workloads;
    // Register status icon handlers
    this.registerBinding(this.icon.checkCircle, 'kd-success', this.isInSuccessState);
    this.registerBinding(this.icon.error, 'kd-error', this.isInErrorState);

    // Register action columns.
    this.registerActionColumn<MenuComponent>('menu', MenuComponent);
  }

  ngOnInit() {
    this.data_.sortingDataAccessor = (item, property) => {
      switch (property) {
        case 'name': return item.objectMeta.name;
        case 'creationTimestamp': return item.status.creationTimestamp;
        case 'namespace': return item.objectMeta.namespace;
        default: return item[property];
      }
    };
  }

  getResourceObservable(params?: HttpParams): Observable<ApplicationList> {
    const res = this.localtionService_.onNamespaceUpdate.subscribe(() => {
      this.namespace = this.localtionService_.current().namespace;
      this.nsList = this.localtionService_.current().namespaceList;
    });
    const data: any = {
      items: [],
      listMeta: {
        totalItems: 0
      }
    };
    if (this.namespace === 'ALL') {
      const list = this.nsList.slice(1);
      const observableList = list.map((ns: any) => {
        return this.application_.get(this.endpoint, undefined, ns.name);
      });
      if (observableList && observableList.length === 0) {
        return new Observable((observer) => {
          observer.next(data);
        });
      }
      return new Observable((observer) => {
        Observable.forkJoin(observableList).subscribe((res: any) => {
          res.map((item: any, index: number) => {
            item.items = item.items.map((v: any) => {
              v.objectMeta.namespace = list[index].name;
              return v;
            });
            data.items = data.items.concat(item.items);
            data.listMeta.totalItems += item.listMeta.totalItems;
          });
          observer.next(data);
        });
      });
    } else if (this.namespace !== undefined) {
      return this.application_.get(this.endpoint, undefined, this.namespace, params);
    }
    return new Observable((observer) => {
      observer.next(data);
    });
  }

  map(applicationList: ApplicationList): Application[] {
    if (this.namespace !== 'ALL') {
      applicationList.items = applicationList.items.map((v: any) => {
        v.objectMeta.namespace = this.namespace;
        return v;
      });
    }
    console.log('applicationList', applicationList);
    return applicationList.items;
  }

  goDetail(value: Application) {
    const location = this.localtionService_.current();
    this.router.navigateByUrl(`/applications/${location.project}-${value.objectMeta.namespace}/${value.objectMeta.name}?cluster=${location.cluster}`);
  }

  isInErrorState(resource: Application): boolean {
    return resource.status ? (resource.status.replicas && resource.status.replicas !== resource.status.availableReplicas ?
       true : false) : false;
  }

  isInSuccessState(resource: Application): boolean {
    return resource.status ? (resource.status.replicas && resource.status.replicas === resource.status.availableReplicas ?
       true : false) : false;
  }

  protected getDisplayColumns(): string[] {
    return ['statusicon', 'name', 'namespace', 'labels', 'replicas', 'creationTimestamp'];
  }

  hasErrors(resource: Application): boolean {
    return this.isInErrorState(resource);
  }
}
