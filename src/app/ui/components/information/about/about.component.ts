import { Component, ViewEncapsulation } from '@angular/core';
import { ContactInformation } from '../../../../common/application/contact-information';
import { ProductInformation } from '../../../../common/application/product-information';
import { DialogServiceBase } from '../../../../services/dialog/dialog.service.base';
import { DesktopBase } from '../../../../common/io/desktop.base';

@Component({
    selector: 'app-about',
    host: { style: 'display: block; width: 100%;' },
    templateUrl: './about.component.html',
    styleUrls: ['./about.component.scss'],
    encapsulation: ViewEncapsulation.None,
})
export class AboutComponent {
    public constructor(
        private dialogService: DialogServiceBase,
        private desktop: DesktopBase,
    ) {
        this.applicationArchitecture = AboutComponent.formatArchitecture(this.desktop.getProcessArchitecture());
    }

    public applicationVersion: string = ProductInformation.applicationVersion;
    public applicationArchitecture: string;
    public applicationCopyright: string = ProductInformation.applicationCopyright;
    public websiteUrl: string = ContactInformation.websiteUrl;
    public mastodonUrl: string = ContactInformation.mastodonUrl;
    public blueskyUrl: string = ContactInformation.blueskyUrl;
    public githubUrl: string = ContactInformation.githubUrl;

    private static formatArchitecture(architecture: string): string {
        switch (architecture) {
            case 'arm64':
                return 'ARM64';
            case 'ia32':
                return 'x86';
            default:
                return architecture;
        }
    }

    public showLicenseDialog(): void {
        this.dialogService.showLicenseDialog();
    }

    public async browseToDonateLinkAsync(): Promise<void> {
        await this.desktop.openLinkAsync(ContactInformation.donateUrl);
    }
}
